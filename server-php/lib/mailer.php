<?php
/* server-php/lib/mailer.php — sign-in code sender.
 * php-mail (prod: host SMTP via PHP mail()) | console (dev, returns devCode). */

require_once __DIR__ . '/config.php';

function mail_code_body(string $code): array {
  return [
    'subject' => "Driftly — код входа / sign-in code: $code",
    'text' => "Ваш код для входа в Driftly: $code\nДействителен 10 минут. Если вы не запрашивали код — проигнорируйте письмо.\n\n"
      . "Your Driftly sign-in code: $code\nValid for 10 minutes. If you didn't request it, ignore this email.",
    'html' => '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">'
      . '<h2 style="margin:0 0 4px">Driftly</h2>'
      . '<p style="margin:0 0 16px;color:#666">Код для входа в аккаунт · Your sign-in code</p>'
      . '<div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f4f3ff;border:1px solid #e3e0ff;border-radius:10px;padding:18px;text-align:center;color:#5b3cf0">' . $code . '</div>'
      . '<p style="margin:16px 0 0;color:#888;font-size:13px">Действителен 10 минут.<br>Valid for 10 minutes.</p></div>',
  ];
}

/** Returns ['name'=>..., 'send'=>callable(email,code):array]. send() throws on failure. */
function mailer_select(): array {
  $want = strtolower(env('DRIFTLY_MAILER', 'console'));

  // Hosting SMTP via PHP mail() — free + self-contained (sends as the domain mailbox
  // through the host's MTA/Exim). multipart/alternative + UTF-8; the envelope sender
  // (-f) aligns Return-Path with the From domain so SPF passes on the shared-host IP.
  if ($want === 'php-mail' || $want === 'smtp') {
    return ['name' => 'php-mail', 'send' => function (string $email, string $code): array {
      $from = env('MAIL_FROM_EMAIL', 'support@driftly.site');
      $fromName = env('MAIL_FROM_NAME', 'Driftly');
      $e = mail_code_body($code);
      $b = 'drf-' . bin2hex(random_bytes(8));
      $subject = '=?UTF-8?B?' . base64_encode($e['subject']) . '?=';
      $headers = implode("\r\n", [
        'MIME-Version: 1.0',
        'From: =?UTF-8?B?' . base64_encode($fromName) . "?= <$from>",
        "Reply-To: $from",
        'Content-Type: multipart/alternative; boundary="' . $b . '"',
      ]);
      $body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($e['text'])) . "\r\n"
        . "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($e['html'])) . "\r\n--$b--";
      if (!@mail($email, $subject, $body, $headers, '-f' . $from)) throw new Exception('php_mail_failed');
      return [];
    }];
  }

  // dev default — logs + returns the code so the flow is testable without a mailbox
  return ['name' => 'console', 'send' => function (string $email, string $code): array {
    error_log("[mailer:console] sign-in code for $email: $code");
    return ['devCode' => $code];
  }];
}
