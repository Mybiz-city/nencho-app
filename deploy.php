<?php
// 自動更新：GitHub の最新版を取ってきて、このフォルダに上書きする
// 使い方： https://metis.tax/nencho/deploy.php?key=（config.php の deploy_key）
// config.php と nencho_data は触らない
declare(strict_types=1);
require_once __DIR__ . '/lib/common.php';
header('Content-Type: text/plain; charset=UTF-8');
$c = cfg();
$key = (string)($_GET['key'] ?? '');
if (!throttle_ok('deploy:' . client_ip(), 5)) { http_response_code(429); exit("NG: 試行回数が多すぎます\n"); }
if (empty($c['deploy_key']) || !hash_equals((string)$c['deploy_key'], $key)) { throttle_fail('deploy:' . client_ip(), 5); audit('deploy denied'); http_response_code(403); exit("NG: key が違います\n"); }
audit('deploy run');
if (empty($c['github_repo'])) exit("NG: config.php の github_repo が空です\n");
if (!class_exists('ZipArchive')) exit("NG: zip拡張がありません\n");

$repo = $c['github_repo']; $branch = $c['github_branch'] ?? 'main';
$url = "https://api.github.com/repos/$repo/zipball/$branch";
$ch = curl_init($url);
$headers = ['User-Agent: nencho-deploy', 'Accept: application/vnd.github+json'];
if (!empty($c['github_token'])) $headers[] = 'Authorization: Bearer ' . $c['github_token'];
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 60, CURLOPT_HTTPHEADER => $headers]);
$zip = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
if ($zip === false || $code !== 200) exit("NG: GitHubから取得できません (HTTP $code) $err\n" . substr((string)$zip, 0, 300) . "\n");

$tmp = sys_get_temp_dir() . '/nencho_deploy_' . bin2hex(random_bytes(4));
mkdir($tmp, 0700, true);
file_put_contents("$tmp/src.zip", $zip);
$za = new ZipArchive();
if ($za->open("$tmp/src.zip") !== true) exit("NG: ZIPを開けません\n");
$za->extractTo("$tmp/x"); $za->close();
$roots = glob("$tmp/x/*", GLOB_ONLYDIR);
if (!$roots) exit("NG: ZIPの中が空です\n");
$src = $roots[0];
// アプリ本体のフォルダ（リポジトリ直下に index.php があればそこ、無ければ app/ の中）
if (!file_exists("$src/index.php") && file_exists("$src/app/index.php")) $src .= '/app';

$skip = ['config.php', '.git', '.gitignore', 'README.md'];
$copied = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
foreach ($it as $f) {
    $rel = substr($f->getPathname(), strlen($src) + 1);
    $top = explode('/', $rel)[0];
    if (in_array($top, $skip, true)) continue;
    $dest = __DIR__ . '/' . $rel;
    if ($f->isDir()) { if (!is_dir($dest)) mkdir($dest, 0755, true); continue; }
    $new = file_get_contents($f->getPathname());
    if (file_exists($dest) && file_get_contents($dest) === $new) continue;
    file_put_contents($dest . '.tmp', $new); rename($dest . '.tmp', $dest);
    $copied[] = $rel;
}
// 後片付け
$rit = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
foreach ($rit as $f) $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
rmdir($tmp);
$ver = date('Y-m-d H:i') . ' ' . basename($roots[0]);
file_put_contents(__DIR__ . '/version.txt', $ver . "\n");
echo "OK: 更新しました（{$ver}）\n更新したファイル " . count($copied) . " 件\n" . implode("\n", $copied) . "\n";
