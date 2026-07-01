<?php
/* server-php/lib/store.php — durable storage via PDO (MySQL on the host, SQLite for
 * local tests). Same shape as the Node store.js: accounts(email→JSON), tokens
 * (device sessions, with a device cap), codes (sign-in codes). */

class Store {
  private PDO $db;
  private string $driver;

  function __construct(PDO $db) {
    $this->db = $db;
    $this->driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $this->migrate();
  }

  /** Connect from env: DB_DSN (+ DB_USER/DB_PASS for MySQL). */
  static function fromEnv(): Store {
    $dsn = getenv('DB_DSN') ?: 'sqlite:' . __DIR__ . '/../.data/driftly.sqlite';
    if (str_starts_with($dsn, 'sqlite:')) { @mkdir(dirname(substr($dsn, 7)), 0775, true); }
    $db = new PDO($dsn, getenv('DB_USER') ?: null, getenv('DB_PASS') ?: null);
    return new Store($db);
  }

  private function migrate(): void {
    $auto = $this->driver === 'mysql' ? 'BIGINT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $txt = $this->driver === 'mysql' ? 'LONGTEXT' : 'TEXT';
    $this->db->exec("CREATE TABLE IF NOT EXISTS accounts (email VARCHAR(255) PRIMARY KEY, data $txt NOT NULL)");
    $this->db->exec("CREATE TABLE IF NOT EXISTS tokens (id $auto, token VARCHAR(64) UNIQUE NOT NULL, email VARCHAR(255) NOT NULL)");
    $this->db->exec("CREATE TABLE IF NOT EXISTS codes (email VARCHAR(255) PRIMARY KEY, hash VARCHAR(64) NOT NULL, exp BIGINT NOT NULL, tries INT NOT NULL DEFAULT 0)");
  }

  /* ---- accounts ---- */
  function getAccount(string $email): ?array {
    $st = $this->db->prepare('SELECT data FROM accounts WHERE email = ?');
    $st->execute([$email]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ? json_decode($row['data'], true) : null;
  }
  function putAccount(array $acc): void {
    $data = json_encode($acc, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($this->driver === 'mysql') {
      $sql = 'INSERT INTO accounts(email, data) VALUES(?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)';
    } else {
      $sql = 'INSERT INTO accounts(email, data) VALUES(?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data';
    }
    $this->db->prepare($sql)->execute([$acc['email'], $data]);
  }
  function deleteAccount(string $email): void {
    $this->db->prepare('DELETE FROM accounts WHERE email = ?')->execute([$email]);
  }
  function allAccounts(): array {
    $rows = $this->db->query('SELECT data FROM accounts')->fetchAll(PDO::FETCH_ASSOC);
    return array_map(fn ($r) => json_decode($r['data'], true), $rows);
  }

  /* ---- device tokens (with cap) ---- */
  function emailForToken(string $token): ?string {
    $st = $this->db->prepare('SELECT email FROM tokens WHERE token = ?');
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ? $row['email'] : null;
  }
  function putToken(string $token, string $email): void {
    $this->db->prepare('INSERT INTO tokens(token, email) VALUES(?, ?)')->execute([$token, $email]);
  }
  function delToken(string $token): void {
    $this->db->prepare('DELETE FROM tokens WHERE token = ?')->execute([$token]);
  }
  function countTokensForEmail(string $email): int {
    $st = $this->db->prepare('SELECT COUNT(*) AS n FROM tokens WHERE email = ?');
    $st->execute([$email]);
    return (int) $st->fetch(PDO::FETCH_ASSOC)['n'];
  }
  /** Keep only the newest $max device tokens for an email; returns # evicted. */
  function pruneTokens(string $email, int $max): int {
    $sql = 'DELETE FROM tokens WHERE email = ? AND id NOT IN '
      . '(SELECT id FROM (SELECT id FROM tokens WHERE email = ? ORDER BY id DESC LIMIT ?) t)';
    $st = $this->db->prepare($sql);
    $st->bindValue(1, $email);
    $st->bindValue(2, $email);
    $st->bindValue(3, $max, PDO::PARAM_INT);
    $st->execute();
    return $st->rowCount();
  }

  /* ---- sign-in codes ---- */
  function getCode(string $email): ?array {
    $st = $this->db->prepare('SELECT hash, exp, tries FROM codes WHERE email = ?');
    $st->execute([$email]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ? ['hash' => $row['hash'], 'exp' => (int) $row['exp'], 'tries' => (int) $row['tries']] : null;
  }
  function putCode(string $email, array $rec): void {
    if ($this->driver === 'mysql') {
      $sql = 'INSERT INTO codes(email, hash, exp, tries) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE hash=VALUES(hash), exp=VALUES(exp), tries=VALUES(tries)';
    } else {
      $sql = 'INSERT INTO codes(email, hash, exp, tries) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, exp=excluded.exp, tries=excluded.tries';
    }
    $this->db->prepare($sql)->execute([$email, $rec['hash'], $rec['exp'], $rec['tries'] ?? 0]);
  }
  function delCode(string $email): void {
    $this->db->prepare('DELETE FROM codes WHERE email = ?')->execute([$email]);
  }
}
