'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const dataDir = path.join(__dirname, 'data');
const authFile = path.join(dataDir, 'auth.json');

if (!process.stdin.isTTY) {
  console.error('Sozlash uchun interaktiv terminal kerak: npm run setup');
  process.exit(1);
}
if (fs.existsSync(authFile)) {
  console.error('Hisob allaqachon sozlangan. Uni tasodifan qayta yozishga ruxsat berilmaydi.');
  process.exit(1);
}

readline.emitKeypressEvents(process.stdin);

function ask(label, secret = false) {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = '';
    function done() {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    }
    function onKey(char, key = {}) {
      if (key.ctrl && key.name === 'c') {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (key.name === 'return' || key.name === 'enter') return done();
      if (key.name === 'backspace') {
        if (value) {
          value = Array.from(value).slice(0, -1).join('');
          if (!secret) process.stdout.write('\b \b');
        }
      } else if (char && !key.ctrl && !key.meta && char >= ' ') {
        value += char;
        if (!secret) process.stdout.write(char);
      }
    }
    process.stdin.on('keypress', onKey);
  });
}

function hash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    hash: crypto.scryptSync(value, Buffer.from(salt, 'hex'), 64).toString('hex')
  };
}

const normAnswer = (answer) => answer.normalize('NFKC').trim().toLocaleLowerCase();

(async () => {
  console.log('\nKUNDALIK — faqat bir marta bajariladigan maxfiy sozlash\n');
  let username;
  do {
    username = (await ask('Login (3–32 ta lotin harfi/raqam/_): ')).trim();
  } while (!/^[a-zA-Z0-9_]{3,32}$/.test(username));

  let password;
  do {
    password = await ask('Kuchli parol (kamida 12 belgi, yashirin): ', true);
    if (password.length < 12) console.log('Parol juda qisqa.');
  } while (password.length < 12);

  const questions = [];
  const answers = [];
  console.log('\nUchta o‘zingizga xos savol tanlang. Javoblar ekranga chiqarilmaydi.');
  for (let i = 1; i <= 3; i++) {
    let question;
    do {
      question = (await ask(`${i}-savol matni: `)).trim();
    } while (question.length < 6 || question.length > 160);
    let answer;
    do {
      answer = normAnswer(await ask(`${i}-savol javobi (yashirin, kamida 4 belgi): `, true));
    } while (answer.length < 4 || answer.length > 200);
    questions.push(question);
    answers.push(hash(answer));
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    authFile,
    JSON.stringify({ username, password: hash(password), questions, answers }, null, 2),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  console.log('\nHisob yaratildi. Endi npm start buyrug‘ini ishga tushiring.');
  console.log('MUHIM: data/ papkasini gitga yuklamang va xavfsiz zaxiralang.');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
