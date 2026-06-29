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
