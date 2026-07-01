<?php
/* server-php/lib/config.php — tiny env loader + helper.
 * Reads server-php/.env (KEY=VALUE, gitignored) once, then env() reads getenv with
 * a default. Keeps secrets (DB creds, API keys, terminal password) out of code. */

(function () {
  $f = __DIR__ . '/../.env';
  if (!is_file($f)) return;
  foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#') continue;
    $eq = strpos($line, '=');
    if ($eq === false) continue;
    $k = trim(substr($line, 0, $eq));
    $v = trim(substr($line, $eq + 1));
    if (strlen($v) >= 2 && ($v[0] === '"' || $v[0] === "'")) $v = substr($v, 1, -1);
    if (getenv($k) === false) putenv("$k=$v");
  }
})();

function env(string $key, $default = null) {
  $v = getenv($key);
  return $v === false ? $default : $v;
}

/** TEMP diagnostics: append a line to a debug log while DRIFTLY_TEST_PAY is set. Remove the flag to disable. */
function dbg_log(string $tag, $data): void {
  if (!env('DRIFTLY_TEST_PAY')) return;
  $line = gmdate('c') . " [$tag] " . (is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) . "\n";
  @file_put_contents(sys_get_temp_dir() . '/driftly-tbank.log', $line, FILE_APPEND);
}
