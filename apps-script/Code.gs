/**
 * SmashStats 同期ブリッジ（共通Apps Script・Webアプリ）
 *
 * 役割: iPhone Web版PWAと、ユーザー自身の Google スプレッドシート1冊のあいだを
 * つなぐだけの薄い橋渡し。試合データはここには保存しない。
 * スプレッドシート側が正本、端末内 IndexedDB が普段の正。競合は最終書き込み勝ち。
 *
 * 使い方: script.google.com で新規プロジェクトを作り、このファイルと
 * appsscript.json を貼り、Webアプリとしてデプロイする。詳しくは DEPLOY.md。
 * 認証はユーザーごとに合言葉で行う。初めて接続するとき（init）に
 * ユーザーが決めた合言葉のハッシュがそのスプレッドシートIDに紐づき、
 * 以後は同じ合言葉でなければ読み書きできない。他のユーザーが
 * スプレッドシートIDを知っていても合言葉なしでは触れない。
 *
 * 呼び出し方（PWA側）:
 *   POST {WebアプリURL}/exec
 *   Content-Type: text/plain（プリフライト回避のため application/json は使わない）
 *   Body: {"action":"push"|"pull"|"init", "secret":"...", "spreadsheetId":"...", ...}
 *   応答は常に JSON {"ok":true/false, ...}（HTTPステータスは常に200）。
 *   認証失敗・制限超過も JSON の ok:false で返すので、呼び出し側は ok を見ること。
 *
 * 設計書: ~/workspace/smashstats-iphone-web/DESIGN.md §2・§4・§5・§6・付録A
 */

/* ================= 定数 ================= */
var SCHEMA_VERSION = 16;
var APP_VERSION = 'smashstats-web-phase2';

/** テーブル定義。columns は DESIGN.md §4.3 の列順（固定）。 */
var TABLES = {
  players: {
    id: 'playerId',
    columns: ['playerId', 'playerName', 'defaultTeamName', 'sportType', 'avatarUri', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { isDeleted: false },
    numbers: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true
  },
  matches: {
    id: 'matchId',
    columns: ['matchId', 'playerId', 'sportType', 'matchType', 'playerTeamNameSnapshot', 'partnerName', 'opponentDisplayName', 'opponentMembersJson', 'opponentTeamNameSnapshot', 'courtSurface', 'environmentType', 'gearId', 'tournamentName', 'tournamentYear', 'matchDateEpochDay', 'finalResultCode', 'roundName', 'tournamentDivision', 'tournamentFormat', 'scoresJson', 'isWin', 'videoPathOrUrl', 'matchNote', 'photoPath', 'isTeamMatch', 'teamMyScore', 'teamOpponentScore', 'weatherType', 'ballOrShuttle', 'isNightMatch', 'venueId', 'elapsedDaysFromMaintenance', 'cumulativeMatchesFromMaintenance', 'createdAt', 'updatedAt', 'isDeleted', 'deletedAt'],
    booleans: { isWin: false, isTeamMatch: false, isNightMatch: null, isDeleted: false },
    numbers: ['tournamentYear', 'matchDateEpochDay', 'teamMyScore', 'teamOpponentScore', 'venueId', 'elapsedDaysFromMaintenance', 'cumulativeMatchesFromMaintenance', 'createdAt', 'updatedAt', 'deletedAt'],
    hasUpdatedAt: true
  },
  gears: {
    id: 'gearId',
    columns: ['gearId', 'playerId', 'sportType', 'racketName', 'stringName', 'tensionValue', 'tensionUnit', 'lastMaintenanceAt', 'customItemsJson', 'isActive', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { isActive: true, isDeleted: false },
    numbers: ['tensionValue', 'lastMaintenanceAt', 'createdAt', 'updatedAt'],
    hasUpdatedAt: true
  },
  gear_maintenances: {
    id: 'maintenanceId',
    columns: ['maintenanceId', 'gearId', 'maintenanceDate', 'note', 'stringName', 'tensionValue', 'tensionUnit', 'createdAt'],
    booleans: {},
    numbers: ['maintenanceDate', 'tensionValue', 'createdAt'],
    hasUpdatedAt: false
  },
  venues: {
    id: 'id',
    columns: ['id', 'name', 'address', 'latitude', 'longitude', 'phone', 'websiteUrl', 'indoorOutdoor', 'facilityCount', 'courtColumns', 'courtRows', 'hasSubCourt', 'subCourtCount', 'subCourtNote', 'parkingAvailable', 'parkingNote', 'parkingFee', 'parkingCrowdedLevel', 'bicycleParkingAvailable', 'nearbyConvenienceStore', 'environmentLevel', 'lightingLevel', 'airConditionLevel', 'surfaceType', 'sportType', 'shootingAllowed', 'tripodAllowed', 'shootingNote', 'importantNote', 'photoUrisJson', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { hasSubCourt: null, parkingAvailable: null, bicycleParkingAvailable: null, shootingAllowed: null, tripodAllowed: null, isDeleted: false },
    numbers: ['id', 'latitude', 'longitude', 'facilityCount', 'courtColumns', 'courtRows', 'subCourtCount', 'createdAt', 'updatedAt'],
    hasUpdatedAt: true
  },
  opponent_profiles: {
    id: 'opponentId',
    columns: ['opponentId', 'playerId', 'name', 'teamName', 'sportType', 'dominantHand', 'strongShotsJson', 'weakShotsJson', 'strongCoursesJson', 'weakCoursesJson', 'tacticalMemo', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { isDeleted: false },
    numbers: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true
  },
  opponent_custom_items: {
    id: 'id',
    columns: ['id', 'category', 'name', 'isVisible', 'createdAt', 'isDeleted'],
    booleans: { isVisible: true, isDeleted: false },
    numbers: ['createdAt'],
    hasUpdatedAt: false
  },
  focuses: {
    id: 'focusId',
    columns: ['focusId', 'playerId', 'title', 'startDate', 'endDate', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { isDeleted: false },
    numbers: ['startDate', 'endDate', 'createdAt', 'updatedAt'],
    hasUpdatedAt: true
  },
  notes: {
    id: 'noteId',
    columns: ['noteId', 'playerId', 'content', 'photoPath', 'noteDate', 'createdAt', 'updatedAt', 'isDeleted'],
    booleans: { isDeleted: false },
    numbers: ['noteDate', 'createdAt', 'updatedAt'],
    hasUpdatedAt: true
  }
};
var TABLE_NAMES = Object.keys(TABLES); // 9テーブル
var META_COLUMNS = ['key', 'value'];

/** 1回の push で処理する行数の上限。超えた分は remaining として返す。 */
var MAX_ROWS_PER_PUSH = 2000;
/** 1回の pull で返す行数（テーブルごと）。0 = 無制限（全量）。 */
var DEFAULT_PULL_LIMIT = 0;
/** 1回の実行で使う時間の上限（ms）。Apps Script は6分で打ち切られるので手前で止める。 */
var MAX_MS_PER_CALL = 240000;
/** 同時書き込みの直列化に使うロックの待機上限（ms）。 */
var LOCK_TIMEOUT_MS = 30000;

/* ================= 入口 ================= */
function doGet() {
  return json_({ ok: true, service: 'smashstats-sync', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION });
}

function doPost(e) {
  var body = {};
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON', message: 'リクエストのJSONが読み取れませんでした。' });
  }
  try {
    var action = body.action;
    if (action !== 'init' && action !== 'push' && action !== 'pull') {
      return json_({ ok: false, error: 'UNKNOWN_ACTION', message: 'action は init / push / pull のいずれかを指定してください。' });
    }
    var spreadsheetId = extractSpreadsheetId_(body.spreadsheetId);
    if (!spreadsheetId) {
      fail_('BAD_SPREADSHEET_ID', 'スプレッドシートのURLまたはIDが読み取れませんでした。');
    }
    assertPassphrase_(body, action, spreadsheetId);
    var ss = openSpreadsheet_(body.spreadsheetId);
    if (action === 'init') return json_(handleInit_(ss));
    if (action === 'push') return json_(handlePush_(ss, body));
    return json_(handlePull_(ss, body));
  } catch (err) {
    if (err && err.code) {
      return json_({ ok: false, error: err.code, message: err.message || err.code, retryAfter: err.retryAfter || null });
    }
    Logger.log('smashstats-sync error: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, error: 'INTERNAL', message: 'ブリッジ側でエラーが発生しました。時間をおいて再度お試しください。' });
  }
}

/* ================= 認証・共通 ================= */
function fail_(code, message, retryAfter) {
  var err = new Error(message || code);
  err.code = code;
  if (retryAfter) err.retryAfter = retryAfter;
  throw err;
}

/** 合言葉は8文字以上。ハッシュだけをスクリプトプロパティに保存する。 */
var MIN_PASSPHRASE_LEN = 8;

function sha256Hex_(s) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    var v = b < 0 ? b + 256 : b;
    var h = v.toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

/**
 * スプレッドシートごとの合言葉認証。
 * 初回 init 時にそのスプレッドシートIDと合言葉のハッシュを紐づけて保存し、
 * 以後は同じ合言葉でなければ読み書きできない（他のユーザーの誤操作・悪用を防ぐ）。
 * 合言葉を忘れた場合は、デプロイ担当がスクリプトプロパティの BIND_<ID> を
 * 消すと次回 init で紐づけ直せる（DEPLOY.md 参照）。
 */
function assertPassphrase_(body, action, spreadsheetId) {
  var pass = body && body.secret ? String(body.secret) : '';
  if (pass.length < MIN_PASSPHRASE_LEN) {
    fail_('PASSPHRASE_TOO_SHORT', '合言葉は8文字以上で入力してください。');
  }
  var key = 'BIND_' + spreadsheetId;
  var props = PropertiesService.getScriptProperties();
  var bound = props.getProperty(key);
  if (!bound) {
    if (action !== 'init') {
      fail_('NOT_INITIALIZED', 'このスプレッドシートはまだ初期化されていません。先に「接続テスト」（初期化）を実行してください。');
    }
    props.setProperty(key, sha256Hex_(pass));
    return;
  }
  if (sha256Hex_(pass) !== bound) {
    fail_('FORBIDDEN', '合言葉が正しくありません。アプリ側の合言葉を確認してください。');
  }
}

/** スプレッドシートID（URLでも可）から開く。開けなければ原因を分けて返す。 */
function openSpreadsheet_(spreadsheetId) {
  var id = extractSpreadsheetId_(spreadsheetId);
  if (!id) {
    fail_('BAD_SPREADSHEET_ID', 'スプレッドシートのURLまたはIDが読み取れませんでした。');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    if (/not found|見つかりません|does not exist/i.test(msg)) {
      fail_('SPREADSHEET_NOT_FOUND', 'スプレッドシートが見つかりません。URLまたはIDを確認してください。');
    }
    if (/permission|権限|access|アクセス/i.test(msg)) {
      fail_('SPREADSHEET_NOT_SHARED', 'スプレッドシートを開けません。このスプレッドシートをブリッジ用アカウントと編集者として共有してください。');
    }
    fail_('SPREADSHEET_OPEN_FAILED', 'スプレッドシートを開けませんでした。(' + msg + ')');
  }
}

/** URL（…/d/<ID>/…）または生IDから ID だけを抜く。 */
function extractSpreadsheetId_(input) {
  if (!input) return null;
  var s = String(input).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = false;
  try {
    ok = lock.tryLock(LOCK_TIMEOUT_MS);
  } catch (err) {
    ok = false;
  }
  if (!ok) {
    fail_('LOCKED', '他の同期が実行中です。少し待ってから再度お試しください。', 5);
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (err) { /* 解放失敗は無視 */ }
  }
}

/* ================= init ================= */
/**
 * 10シート（9テーブル＋_meta）が無ければ作り、1行目に列ヘッダーを書く。
 * 既存シートのヘッダーが違う場合は上書きせず HEADER_MISMATCH を返す。
 */
function handleInit_(ss) {
  return withLock_(function() {
    var created = [];
    var existing = [];
    TABLE_NAMES.forEach(function(name) {
      var def = TABLES[name];
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.getRange(1, 1, 1, def.columns.length).setValues([def.columns]);
        created.push(name);
      } else {
        var header = readHeader_(sheet);
        if (header.length === 0) {
          sheet.getRange(1, 1, 1, def.columns.length).setValues([def.columns]);
          created.push(name);
        } else if (!sameHeader_(header, def.columns)) {
          fail_('HEADER_MISMATCH', 'シート「' + name + '」の列構成が想定と違います。上書きはしないので、テンプレート通りのシートか確認してください。');
        } else {
          existing.push(name);
        }
      }
    });
    var meta = ss.getSheetByName('_meta');
    if (!meta) {
      meta = ss.insertSheet('_meta');
      meta.getRange(1, 1, 1, META_COLUMNS.length).setValues([META_COLUMNS]);
      created.push('_meta');
    } else if (readHeader_(meta).length === 0) {
      meta.getRange(1, 1, 1, META_COLUMNS.length).setValues([META_COLUMNS]);
      created.push('_meta');
    } else if (!sameHeader_(readHeader_(meta), META_COLUMNS)) {
      fail_('HEADER_MISMATCH', 'シート「_meta」の列構成が想定と違います。上書きはしないので、テンプレート通りのシートか確認してください。');
    } else {
      existing.push('_meta');
    }
    upsertMeta_(ss, {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastInitAt: new Date().getTime()
    });
    return { ok: true, schemaVersion: SCHEMA_VERSION, created: created, existing: existing };
  });
}

function readHeader_(sheet) {
  if (sheet.getLastRow() < 1) return [];
  var row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === null)) row.pop();
  return row;
}

function sameHeader_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (String(a[i]) !== String(b[i])) return false;
  }
  return true;
}

/* ================= push ================= */
/**
 * rows: {テーブル名: [行オブジェクト, ...]}
 * ID列で照合し、更新・追加する。updatedAt が新しい方だけ採用し、
 * 古い書き込みは conflicts に入れて返す（サーバー側の行は残す）。
 * 処理上限を超えた分は remaining として返し、クライアントが続きを呼ぶ。
 */
function handlePush_(ss, body) {
  var rows = body.rows || {};
  var deviceId = body.deviceId || '';
  var startedAt = new Date().getTime();
  return withLock_(function() {
    var applied = {};
    var conflicts = [];
    var skipped = 0;
    var remaining = {};
    var processed = 0;
    var stoppedEarly = false;

    TABLE_NAMES.forEach(function(name) {
      if (stoppedEarly) {
        if (rows[name] && rows[name].length) remaining[name] = rows[name];
        return;
      }
      var list = rows[name];
      if (!list || !list.length) return;
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        fail_('SHEET_NOT_FOUND', 'シート「' + name + '」がありません。先に接続テスト（init）を実行してください。');
      }
      var def = TABLES[name];
      var values = readAllValues_(sheet, def.columns.length);
      var header = values.length ? values[0] : def.columns;
      var idIdx = def.columns.indexOf(def.id);
      var updatedIdx = def.hasUpdatedAt ? def.columns.indexOf('updatedAt') : -1;
      var indexById = {};
      for (var r = 1; r < values.length; r++) {
        var idVal = values[r][idIdx];
        if (idVal === '' || idVal === null || idVal === undefined) continue;
        indexById[String(idVal)] = r;
      }
      var count = 0;
      var rest = [];
      for (var i = 0; i < list.length; i++) {
        if (processed >= MAX_ROWS_PER_PUSH || (new Date().getTime() - startedAt) > MAX_MS_PER_CALL) {
          rest = list.slice(i);
          stoppedEarly = true;
          break;
        }
        var row = list[i];
        var idVal = row ? row[def.id] : null;
        if (idVal === '' || idVal === null || idVal === undefined) { skipped++; processed++; continue; }
        var line = objectToRow_(def, row);
        var at = indexById[String(idVal)];
        if (at !== undefined) {
          if (def.hasUpdatedAt) {
            var incomingUp = toNumber_(row.updatedAt) || 0;
            var existingUp = toNumber_(values[at][updatedIdx]) || 0;
            if (incomingUp < existingUp) {
              conflicts.push({
                table: name,
                rowId: String(idVal),
                clientUpdatedAt: incomingUp,
                serverUpdatedAt: existingUp,
                serverRow: rowToObject_(def, values[at])
              });
              processed++;
              continue;
            }
          }
          values[at] = line;
        } else {
          values.push(line);
          indexById[String(idVal)] = values.length - 1;
        }
        count++;
        processed++;
      }
      if (rest.length) remaining[name] = rest;
      if (count > 0 || values.length > 1) {
        sheet.getRange(1, 1, values.length, def.columns.length).setValues(values);
      }
      applied[name] = count;
    });

    var serverTime = new Date().getTime();
    var counts = {};
    TABLE_NAMES.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      counts[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
    });
    upsertMeta_(ss, {
      schemaVersion: SCHEMA_VERSION,
      lastSyncAt: serverTime,
      lastSyncDeviceId: deviceId,
      rowCounts: JSON.stringify(counts)
    });
    return {
      ok: true,
      applied: applied,
      conflicts: conflicts,
      skipped: skipped,
      partial: stoppedEarly,
      remaining: remaining,
      serverTime: serverTime
    };
  });
}

/* ================= pull ================= */
/**
 * 全9シート＋_meta の全行を返す。offset/limit を指定すれば分割取得もできる。
 * 要求: {offset:{テーブル名:開始行(0始まり)}, limit:1回あたりの行数(0=無制限)}
 * 応答: {rows:{...}, hasMore:{...}, nextOffset:{...}, serverTime}
 */
function handlePull_(ss, body) {
  return withLock_(function() {
    var limit = body.limit ? Number(body.limit) || 0 : DEFAULT_PULL_LIMIT;
    var offset = body.offset || {};
    var rows = {};
    var hasMore = {};
    var nextOffset = {};
    TABLE_NAMES.concat(['_meta']).forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        rows[name] = [];
        hasMore[name] = false;
        nextOffset[name] = 0;
        return;
      }
      var values = readAllValues_(sheet, name === '_meta' ? META_COLUMNS.length : TABLES[name].columns.length);
      var dataRows = values.length > 1 ? values.slice(1) : [];
      var start = Number(offset[name]) || 0;
      var end = limit > 0 ? Math.min(dataRows.length, start + limit) : dataRows.length;
      var out = [];
      for (var i = start; i < end; i++) {
        var obj = name === '_meta'
          ? rowToObject_({ columns: META_COLUMNS, booleans: {}, numbers: [], hasUpdatedAt: false, id: 'key' }, dataRows[i])
          : rowToObject_(TABLES[name], dataRows[i]);
        if (obj[TABLES[name] ? TABLES[name].id : 'key'] === '' ||
            obj[TABLES[name] ? TABLES[name].id : 'key'] === null ||
            obj[TABLES[name] ? TABLES[name].id : 'key'] === undefined) continue;
        out.push(obj);
      }
      rows[name] = out;
      hasMore[name] = end < dataRows.length;
      nextOffset[name] = end;
    });
    return { ok: true, rows: rows, hasMore: hasMore, nextOffset: nextOffset, serverTime: new Date().getTime() };
  });
}

/* ================= 行⇔オブジェクト変換 ================= */
function readAllValues_(sheet, width) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  return sheet.getRange(1, 1, lastRow, Math.max(width, lastCol)).getValues();
}

/** シートの1行（配列）→ 行オブジェクト。空セルは型に合わせて null / 既定値にする。 */
function rowToObject_(def, values) {
  var obj = {};
  def.columns.forEach(function(col, i) {
    var v = values[i];
    if (v === '' || v === null || v === undefined) {
      if (col in def.booleans) { obj[col] = def.booleans[col]; return; }
      if (def.numbers.indexOf(col) >= 0) { obj[col] = null; return; }
      obj[col] = null;
      return;
    }
    if (col in def.booleans) { obj[col] = (v === true || v === 'TRUE' || v === 'true'); return; }
    if (def.numbers.indexOf(col) >= 0) { obj[col] = toNumber_(v); return; }
    obj[col] = v;
  });
  return obj;
}

/** 行オブジェクト → シートの1行（配列）。undefined は空セルにする。 */
function objectToRow_(def, obj) {
  return def.columns.map(function(col) {
    var v = obj[col];
    if (v === undefined || v === null) return '';
    if (col in def.booleans) return !!v;
    if (def.numbers.indexOf(col) >= 0) {
      var n = toNumber_(v);
      return n === null ? '' : n;
    }
    return v;
  });
}

function toNumber_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/** _meta シートの key 行を更新・追加する。 */
function upsertMeta_(ss, kv) {
  var sheet = ss.getSheetByName('_meta');
  if (!sheet) return;
  var values = readAllValues_(sheet, META_COLUMNS.length);
  if (!values.length) {
    values = [META_COLUMNS.slice()];
  }
  var indexByKey = {};
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] !== '' && values[r][0] !== null) indexByKey[String(values[r][0])] = r;
  }
  Object.keys(kv).forEach(function(k) {
    var v = kv[k];
    if (v === undefined || v === null) v = '';
    var line = [k, v];
    if (indexByKey[k] !== undefined) values[indexByKey[k]] = line;
    else { values.push(line); indexByKey[k] = values.length - 1; }
  });
  sheet.getRange(1, 1, values.length, META_COLUMNS.length).setValues(values);
}
