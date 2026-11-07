<?php
// 従業員画面の裏側（JSONで受け答え）
declare(strict_types=1);
require_once __DIR__ . '/lib/common.php';
require_once __DIR__ . '/lib/judge.php';
require_once __DIR__ . '/lib/ics.php';
require_once __DIR__ . '/lib/claude.php';
require_once __DIR__ . '/lib/drive.php';

session_start();
$action = $_GET['a'] ?? '';
$in = json_decode((string)file_get_contents('php://input'), true) ?: [];

function line_map_path(): string { return data_dir() . '/_line_map.json'; }

function current_emp(): array {
    if (empty($_SESSION['client']) || empty($_SESSION['emp'])) fail('ログインしてください', 401);
    return [$_SESSION['client'], $_SESSION['emp']];
}

/** 画面に返す形（rawは重いので省く） */
function pack_record(array $r): array {
    $r['computed'] = compute($r);
    if (isset($r['prev']['raw'])) unset($r['prev']['raw']);
    $r['config'] = ['app_name' => cfg()['app_name'], 'color' => cfg()['brand_color'], 'year' => cfg()['year'], 'deadline' => cfg()['deadline_text'], 'ai' => !empty(cfg()['anthropic_api_key']), 'liff_id' => cfg()['liff_id']];
    return $r;
}

switch ($action) {
    case 'config':
        json_out(['ok' => true, 'app_name' => cfg()['app_name'], 'color' => cfg()['brand_color'], 'year' => cfg()['year'], 'deadline' => cfg()['deadline_text'], 'liff_id' => cfg()['liff_id'], 'logged_in' => !empty($_SESSION['emp'])]);

    case 'line_login': // LINEのIDだけで入れるか
        $uid = trim((string)($in['line_user_id'] ?? ''));
        if ($uid === '') fail('LINEのIDがありません');
        $map = json_load(line_map_path(), []);
        if (empty($map[$uid])) json_out(['ok' => true, 'known' => false]);
        $_SESSION['client'] = $map[$uid]['client']; $_SESSION['emp'] = $map[$uid]['emp'];
        $r = load_record($map[$uid]['client'], $map[$uid]['emp']);
        json_out(['ok' => true, 'known' => true, 'record' => pack_record($r)]);

    case 'login':
        $p = parse_code((string)($in['code'] ?? ''));
        if (!$p) fail('登録コードは数字で入れてください（例：0302000001）');
        if (!is_dir(data_dir() . '/' . $p['client'])) fail('この登録コードの会社は、まだ登録されていません。事務所にご確認ください');
        $emp = resolve_emp($p['client'], $p['num']);
        if (!$emp) fail('この登録コードは見つかりません。数字をもう一度ご確認ください');
        $_SESSION['client'] = $p['client']; $_SESSION['emp'] = $emp;
        $r = load_record($p['client'], $emp);
        $uid = trim((string)($in['line_user_id'] ?? ''));
        if ($uid !== '') {
            $map = json_load(line_map_path(), []);
            $map[$uid] = ['client' => $p['client'], 'emp' => $emp, 'at' => date('c')];
            json_save(line_map_path(), $map);
            $r['line_user_id'] = $uid;
        }
        if ($r['status'] === 'new') $r['status'] = 'in_progress';
        save_record($r);
        json_out(['ok' => true, 'record' => pack_record($r)]);

    case 'logout':
        session_destroy(); json_out(['ok' => true]);

    case 'load':
        [$c, $e] = current_emp();
        json_out(['ok' => true, 'record' => pack_record(load_record($c, $e))]);

    case 'save':
        [$c, $e] = current_emp();
        $r = load_record($c, $e);
        if (isset($in['answers']) && is_array($in['answers'])) $r['answers'] = array_merge($r['answers'], $in['answers']);
        if (isset($in['family']) && is_array($in['family'])) $r['family'] = array_values($in['family']);
        if (!empty($in['consent'])) $r['consent_at'] = $r['consent_at'] ?? date('c');
        if (isset($in['step'])) $r['last_step'] = $in['step'];
        if (!empty($in['change'])) $r['changes'][] = ['at' => date('c'), 'what' => $in['change']];
        if ($r['status'] === 'submitted' && empty($in['reopen'])) { /* 提出後の変更も許す（再提出扱い） */ $r['status'] = 'in_progress'; }
        $r['updated_at'] = date('c');
        save_record($r);
        json_out(['ok' => true, 'record' => pack_record($r)]);

    case 'upload': // multipart: photo, kind
        [$c, $e] = current_emp();
        if (empty($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) fail('写真を受け取れませんでした');
        $kind = preg_replace('/[^a-z_]/', '', (string)($_POST['kind'] ?? 'cert'));
        $r = load_record($c, $e);
        $id = date('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 6);
        $ext = match (mime_content_type($_FILES['photo']['tmp_name'])) { 'image/png' => 'png', 'image/webp' => 'webp', default => 'jpg' };
        $name = "{$kind}_{$id}.{$ext}";
        $dest = emp_dir($c, $e) . "/photos/$name";
        $tmp = $_FILES['photo']['tmp_name'];
        // 大きすぎる写真は縮小（長辺2000px）
        if (function_exists('imagecreatefromstring') && $_FILES['photo']['size'] > 1500000) {
            $img = @imagecreatefromstring((string)file_get_contents($tmp));
            if ($img) {
                $w = imagesx($img); $h = imagesy($img); $s = 2000 / max($w, $h);
                if ($s < 1) { $n = imagescale($img, (int)($w * $s), (int)($h * $s)); imagejpeg($n, $dest, 88); imagedestroy($n); }
                else move_uploaded_file($tmp, $dest);
                imagedestroy($img);
            } else move_uploaded_file($tmp, $dest);
        } else move_uploaded_file($tmp, $dest);
        $entry = ['id' => $id, 'kind' => $kind, 'file' => $name, 'at' => date('c'), 'status' => 'uploaded', 'items' => [], 'ai' => null, 'drive_id' => null];
        // ドライブへ
        try { $entry['drive_id'] = drive_upload($c, $e, $dest, $name, "image/$ext"); } catch (Throwable $ex) { $entry['drive_error'] = $ex->getMessage(); }
        // AI読み取り（証明書のときだけ）
        if ($kind === 'cert' && !empty(cfg()['anthropic_api_key'])) {
            try {
                $ai = claude_read_cert($dest);
                $entry['ai'] = $ai; $entry['items'] = $ai['items']; $entry['issuer'] = $ai['issuer'] ?? ''; $entry['doc_type'] = $ai['doc_type'] ?? '';
                $entry['status'] = 'read';
            } catch (Throwable $ex) { $entry['status'] = 'read_failed'; $entry['error'] = $ex->getMessage(); }
        }
        $r['certs'][] = $entry;
        save_record($r);
        json_out(['ok' => true, 'cert' => $entry, 'record' => pack_record($r)]);

    case 'cert_update': // {id, items, issuer, status:'confirmed'|'deleted'}
        [$c, $e] = current_emp();
        $r = load_record($c, $e);
        foreach ($r['certs'] as &$ct) {
            if ($ct['id'] !== ($in['id'] ?? '')) continue;
            if (isset($in['items'])) {
                $before = json_encode($ct['items'], JSON_UNESCAPED_UNICODE);
                $ct['items'] = array_values($in['items']);
                if ($before !== json_encode($ct['items'], JSON_UNESCAPED_UNICODE)) $r['changes'][] = ['at' => date('c'), 'what' => '証明書 ' . $ct['id'] . ' を本人が訂正', 'before' => $before];
            }
            if (isset($in['issuer'])) $ct['issuer'] = $in['issuer'];
            if (isset($in['status'])) { $ct['status'] = $in['status']; if ($in['status'] === 'read') $ct['confirmed'] = false; if ($in['status'] === 'confirmed') $ct['confirmed'] = true; }
            if (isset($in['cat'])) $ct['cat'] = preg_replace('/[^a-z_]/', '', (string)$in['cat']);
            if (isset($in['sub'])) $ct['sub'] = preg_replace('/[^a-z_]/', '', (string)$in['sub']);
            if (isset($in['confirmed'])) $ct['confirmed'] = (bool)$in['confirmed'];
        }
        unset($ct);
        save_record($r);
        json_out(['ok' => true, 'record' => pack_record($r)]);

    case 'photo': // 自分の写真を見る
        [$c, $e] = current_emp();
        $f = basename((string)($_GET['f'] ?? ''));
        $p = emp_dir($c, $e) . "/photos/$f";
        if (!file_exists($p)) fail('見つかりません', 404);
        header('Content-Type: ' . mime_content_type($p)); readfile($p); exit;

    case 'reset': // 今年の入力をすべて消す（前年と登録コードの対応は残す）
        [$c, $e] = current_emp();
        $r = load_record($c, $e);
        $dir = emp_dir($c, $e);
        foreach (glob("$dir/photos/*") ?: [] as $f) @unlink($f);
        @unlink("$dir/submitted.json");
        $n = empty_record($c, $e); $n['prev'] = $r['prev']; $n['prev_certs'] = $r['prev_certs'] ?? []; $n['line_user_id'] = $r['line_user_id']; $n['status'] = 'in_progress';
        $n['reset_log'] = array_merge($r['reset_log'] ?? [], [date('c')]);
        save_record($n);
        json_out(['ok' => true, 'record' => pack_record($n)]);

    case 'submit':
        [$c, $e] = current_emp();
        $r = load_record($c, $e);
        $r['status'] = 'submitted'; $r['submitted_at'] = date('c');
        $r['computed'] = compute($r);
        save_record($r);
        // 提出内容をドライブにも
        $final = emp_dir($c, $e) . '/submitted.json';
        json_save($final, $r);
        try { drive_upload($c, $e, $final, 'submitted.json', 'application/json'); } catch (Throwable $ex) {}
        json_out(['ok' => true, 'record' => pack_record($r)]);

    default:
        fail('不明な操作', 404);
}
