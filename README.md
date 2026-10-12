# Kundalik — shaxsiy elektron daftar

Bu loyiha bitta foydalanuvchiga mo‘ljallangan, server orqali himoyalangan shaxsiy kundalik.

**Kirish:** login + parol + 3 ta maxfiy savolning javobi. Maxfiy javoblar dastur kodiga kiritilmaydi, balki faqat serverda tuz va `scrypt` xeshi sifatida saqlanadi.

## Ishga tushirish

Node.js 20 yoki undan yangi versiya kerak.

```bash
npm run setup
npm start
```

1. `npm run setup` bosqichida login, kuchli parol va 3 ta savol hamda javoblarini tanlang.
2. `npm start` dan keyin `http://localhost:3000` manzilini oching.
3. Boshqa port uchun `PORT=4000 npm start` ishlatish mumkin.

**Muhim:** `data/` papkasida shaxsiy yozuvlar va maxfiy ma'lumotlarning xeshlari turadi. Papka `.gitignore` bilan himoyalangan — uni GitHub'ga qo‘shmang. Parol va javoblar esdan chiqsa, ularni qayta tiklash avtomatik imkoni yo‘q. `data/` ning xavfsiz zaxira nusxasini saqlang.

## Joylash (deploy)

Bu **Node.js serverli** sayt: GitHub Pages'da ishlamaydi, chunki GitHub Pages faqat statik fayllarni beradi. Node.js hostingi va **doimiy (persistent) disk** talab etiladi; saytning kirish ma'lumotlari va yozuvlari `data/` ichida qolishi kerak. Tashqi internetga chiqarishda HTTPS, `NODE_ENV=production`, doimiy disk va muntazam zaxira nusxalar talab qilinadi. Dastlabki sozlashni server terminalida bajaring; webda ochiq ro‘yxatdan o‘tish yo‘q.

Repository hozir public bo‘lishi mumkin: kod ochiq, ammo maxfiy login ma'lumotlari **hech qachon** gitga yozilmaydi. Qo‘shimcha himoya uchun GitHub Settings → Danger Zone → Change repository visibility orqali Private tanlang.

## Xususiyatlar

- Login + parol + uchta moslashtiriladigan maxfiy savol
- `scrypt` bilan alohida tuzlangan (salted) maxfiy xeshlar
- Server tarafdagi tekshiruv, kirish urinishlarini cheklash
- `HttpOnly`, `SameSite=Strict` seans cookie; productionda `Secure`
- CSRF-token bilan yozish amallarini himoyalash
- Yozuv qo‘shish, tahrirlash, o‘chirish, qidirish va saralash
- Responsive, o‘zbekcha interfeys
- JSON ma'lumotlar serverning doimiy `data/` papkasida saqlanadi

**Xavfsizlik eslatmasi:** uchta savol ikki bosqichli autentifikatsiya o‘rnini bosmaydi; javoblar taxmin qilib topilmaydigan, noyob bo‘lishi lozim.
