<?php
/* server-php/keygen.php — generate the ES256 (EC P-256) license keypair.
 * Run once:  php keygen.php
 * Writes .keys/ec-private.pem (KEEP SECRET) + .keys/ec-public.pem.
 * Put the PUBLIC key into the clients (shared/license-public.pem). */

$dir = __DIR__ . '/.keys';
@mkdir($dir, 0700, true);

$res = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
if (!$res) { fwrite(STDERR, "openssl_pkey_new failed\n"); exit(1); }

openssl_pkey_export($res, $priv);
$pub = openssl_pkey_get_details($res)['key'];

file_put_contents("$dir/ec-private.pem", $priv);
chmod("$dir/ec-private.pem", 0600);
file_put_contents("$dir/ec-public.pem", $pub);

echo "Wrote $dir/ec-private.pem (secret) and ec-public.pem\n\n";
echo "Public key (embed in clients as shared/license-public.pem):\n$pub\n";
