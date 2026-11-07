<?php
// Googleドライブへの保存（サービスアカウント）。設定が空なら何もしない
declare(strict_types=1);
require_once __DIR__ . '/common.php';

function drive_enabled(): bool {
    $c = cfg();
    return !empty($c['drive_service_account_json']) && !empty($c['drive_root_folder_id']) && file_exists($c['drive_service_account_json']);
}

/** サービスアカウントのJSON鍵 → アクセストークン（1時間有効。data_dir にキャッシュ） */
function drive_token(): string {
    $cacheF = data_dir() . '/_drive_token.json';
    $cache = json_load($cacheF);
    if ($cache && ($cache['exp'] ?? 0) > time() + 60) return $cache['token'];
    $sa = json_decode((string)file_get_contents(cfg()['drive_service_account_json']), true);
    $now = time();
    $b64 = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $header = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claim = $b64(json_encode(['iss' => $sa['client_email'], 'scope' => 'https://www.googleapis.com/auth/drive', 'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600]));
    openssl_sign("$header.$claim", $sig, $sa['private_key'], 'sha256WithRSAEncryption');
    $jwt = "$header.$claim." . $b64($sig);
    $res = http_post('https://oauth2.googleapis.com/token', http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]), ['Content-Type: application/x-www-form-urlencoded']);
    $j = json_decode($res, true);
    if (empty($j['access_token'])) throw new RuntimeException('ドライブの認証に失敗: ' . substr($res, 0, 200));
    json_save($cacheF, ['token' => $j['access_token'], 'exp' => $now + (int)($j['expires_in'] ?? 3600)]);
    return $j['access_token'];
}

function http_post(string $url, string $body, array $headers): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body]);
    $r = curl_exec($ch); $e = curl_error($ch); curl_close($ch);
    if ($r === false) throw new RuntimeException('通信失敗: ' . $e);
    return (string)$r;
}
function http_get(string $url, array $headers): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HTTPHEADER => $headers]);
    $r = curl_exec($ch); curl_close($ch);
    return (string)$r;
}

/** 親フォルダの中に name のフォルダを探し、無ければ作る → ID */
function drive_folder(string $parentId, string $name): string {
    $tok = drive_token();
    $q = sprintf("name = '%s' and '%s' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false", str_replace("'", "\\'", $name), $parentId);
    $res = json_decode(http_get('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&q=' . rawurlencode($q) . '&fields=files(id)', ["Authorization: Bearer $tok"]), true);
    if (!empty($res['files'][0]['id'])) return $res['files'][0]['id'];
    $res = json_decode(http_post('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', json_encode(['name' => $name, 'mimeType' => 'application/vnd.google-apps.folder', 'parents' => [$parentId]]), ["Authorization: Bearer $tok", 'Content-Type: application/json']), true);
    if (empty($res['id'])) throw new RuntimeException('フォルダ作成に失敗: ' . json_encode($res));
    return $res['id'];
}

/** 顧問先／年／従業員 のフォルダIDを返す（キャッシュ付き） */
function drive_emp_folder(string $client, string $emp): string {
    $cacheF = data_dir() . '/_drive_folders.json';
    $cache = json_load($cacheF, []);
    $key = "$client/" . cfg()['year'] . "/$emp";
    if (!empty($cache[$key])) return $cache[$key];
    $root = cfg()['drive_root_folder_id'];
    $c = drive_folder($root, $client);
    $y = drive_folder($c, (string)cfg()['year']);
    $e = drive_folder($y, $emp);
    $cache[$key] = $e; json_save($cacheF, $cache);
    return $e;
}

/** ファイルを従業員フォルダへ上げる（同名があれば上書き）→ ファイルID */
function drive_upload(string $client, string $emp, string $localPath, string $name, string $mime): ?string {
    if (!drive_enabled()) return null;
    $tok = drive_token();
    $folder = drive_emp_folder($client, $emp);
    $q = sprintf("name = '%s' and '%s' in parents and trashed = false", str_replace("'", "\\'", $name), $folder);
    $ex = json_decode(http_get('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&q=' . rawurlencode($q) . '&fields=files(id)', ["Authorization: Bearer $tok"]), true);
    $meta = json_encode(['name' => $name, 'parents' => [$folder]]);
    $boundary = 'nencho' . bin2hex(random_bytes(8));
    $body = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$meta\r\n--$boundary\r\nContent-Type: $mime\r\n\r\n" . file_get_contents($localPath) . "\r\n--$boundary--";
    if (!empty($ex['files'][0]['id'])) {
        $id = $ex['files'][0]['id'];
        $body = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--$boundary\r\nContent-Type: $mime\r\n\r\n" . file_get_contents($localPath) . "\r\n--$boundary--";
        $ch = curl_init("https://www.googleapis.com/upload/drive/v3/files/$id?uploadType=multipart&supportsAllDrives=true");
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'PATCH', CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer $tok", "Content-Type: multipart/related; boundary=$boundary"], CURLOPT_POSTFIELDS => $body]);
        $r = curl_exec($ch); curl_close($ch);
        return $id;
    }
    $r = http_post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', $body, ["Authorization: Bearer $tok", "Content-Type: multipart/related; boundary=$boundary"]);
    $j = json_decode($r, true);
    return $j['id'] ?? null;
}
