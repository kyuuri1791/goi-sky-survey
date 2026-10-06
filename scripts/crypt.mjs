// 載せない言葉の一覧（data-src/ng-words.txt）を暗号化して data-src/ng.enc に入れる。
// 中身は公開しないので、git には ng.enc だけを入れる。鍵は環境変数 NG_KEY か、git に入れない .env の NG_KEY。
//
//   node scripts/crypt.mjs encrypt   data-src/ng-words.txt → data-src/ng.enc
//   node scripts/crypt.mjs decrypt   data-src/ng.enc → data-src/ng-words.txt
//
// 形式: "NGE2"（4 バイト）、scrypt のソルト（16）、IV（12）、認証タグ（16）、暗号文（一覧を gzip したもの）。
// 暗号は Node 組み込みの AES-256-GCM。
// 鍵をなくすと復号できないので、パスワード管理ソフトなど別の場所にも控えておくこと。
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const PLAIN = "data-src/ng-words.txt";
const OUT = "data-src/ng.enc";
const MAGIC = Buffer.from("NGE2");

function readKey() {
  if (process.env.NG_KEY) return process.env.NG_KEY;
  if (fs.existsSync(".env")) {
    const line = fs.readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("NG_KEY="));
    if (line) return line.slice("NG_KEY=".length).trim();
  }
  throw new Error("鍵がありません。環境変数 NG_KEY か .env の NG_KEY を設定してください");
}

const derive = (pass, salt) => crypto.scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

const cmd = process.argv[2];
if (cmd === "encrypt") {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derive(readKey(), salt), iv);
  const enc = Buffer.concat([cipher.update(zlib.gzipSync(fs.readFileSync(PLAIN))), cipher.final()]);
  fs.writeFileSync(OUT, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), enc]));
  console.log(`${PLAIN} → ${OUT}`);
} else if (cmd === "decrypt") {
  const buf = fs.readFileSync(OUT);
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error(`${OUT} の形式が違います`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", derive(readKey(), buf.subarray(4, 20)), buf.subarray(20, 32));
  decipher.setAuthTag(buf.subarray(32, 48));
  let body;
  try {
    body = Buffer.concat([decipher.update(buf.subarray(48)), decipher.final()]);
  } catch {
    throw new Error("復号できませんでした（鍵が違うか、ファイルが壊れています）");
  }
  fs.writeFileSync(PLAIN, zlib.gunzipSync(body));
  console.log(`${OUT} → ${PLAIN}`);
} else {
  console.log("使い方: node scripts/crypt.mjs encrypt | decrypt");
  process.exit(1);
}
