<?php
// ============================================================
// 年調アプリ 設定ファイル
// このファイルを config.php という名前でコピーして、値を書き換える
// ============================================================
return [
    // 対象年（令和8年分 = 2026）
    'year' => 2026,

    // データの置き場所。www の外に置く（ブラウザから見えない場所）
    // さくらの例: /home/chosa/nencho_data
    'data_dir' => dirname(__DIR__) . '/nencho_data',

    // 事務所画面のパスワード（長めに）
    'admin_password' => 'ここを変える',
    // 事務所画面の2段階認証（任意）。Google Authenticator などに登録する秘密の文字列（英大文字と2〜7、16文字以上）。空なら使わない
    'admin_totp_secret' => '',

    // Claude API（証明書の読み取り）。空なら読み取りを使わず手入力のみ
    'anthropic_api_key' => '',
    'anthropic_model' => 'claude-sonnet-5-5',

    // LINE LIFF のID。空ならブラウザだけで動く（登録コード入力）
    'liff_id' => '',

    // Googleドライブ（任意）。サービスアカウントのJSONファイルのパスと、保存先フォルダのID
    // 空ならドライブには送らず、data_dir にだけ保存する
    'drive_service_account_json' => '',
    'drive_root_folder_id' => '',

    // 自動更新（deploy.php）。GitHub のリポジトリ名と、更新を許す合言葉
    'github_repo' => '',          // 例: Mybiz-city/nencho-app
    'github_branch' => 'main',
    'github_token' => '',         // 非公開リポジトリのときだけ。GitHub の Personal access token（repo の読み取り）
    'deploy_key' => '',           // 長いランダム文字列。https://metis.tax/nencho/deploy.php?key=この値 で更新

    // 画面の名前と色
    'app_name' => 'メーティス 年末調整',
    'brand_color' => '#00A88E',

    // 提出期限（画面に表示するだけ）
    'deadline_text' => '令和8年12月4日（金）',

    // 税制の数字（令和8年分）。年が変われば、ここだけ直す
    'tax' => [
        'salary_deduction_min' => 740000,   // 給与所得控除の最低額
        'salary_deduction_flat_upto' => 2190000, // この年収未満は「年収−最低額」で所得を出す
        'pension_deduction_over65' => 1100000,
        'pension_deduction_under65' => 600000,
        'pension_simple_upto' => 1300000,   // この年金額未満は単純控除で計算
        'dependent_income_max' => 620000,   // 扶養・配偶者控除の所得上限
        'spouse_special_income_max' => 1330000, // 配偶者特別控除の所得上限
        'special_relative_income_max' => 1230000, // 特定親族特別控除の所得上限（年収197万相当）
        'special_relative_gensen_income_max' => 850000, // この所得以下の特定親族は「扶特親(源)」、超えると「扶特親」
        'working_student_income_max' => 890000,
        'self_income_max_for_spouse' => 10000000,  // 本人所得がこれ超なら配偶者控除なし
        'self_income_max_for_gensen' => 9000000,   // 源泉控除対象配偶者の本人所得上限
        'spouse_income_max_for_gensen' => 950000,  // 源泉控除対象配偶者の配偶者所得上限
        'adjust_income_threshold' => 8500000,      // 所得金額調整控除（年収850万超）
    ],
];
