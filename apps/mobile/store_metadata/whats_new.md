# U Learn — What's New

**Version:** 1.0.20 (build 22)  
**Date:** 2026-07-24

Use the localized text below for App Store Connect / Google Play “What’s New”.

---

## English (en-US)

Whiteboard lessons open reliably on Android course details, including boards with PDF backgrounds. Teachers can edit published board lessons; admins review only the changed time ranges. Also includes offline board playback and upload progress when publishing.

---

## Arabic (ar-SA)

دروس السبورة تفتح بشكل موثوق على أندرويد في تفاصيل الدورة، بما في ذلك اللوحات ذات خلفية PDF. يمكن للمعلمين تعديل دروس اللوحة المنشورة، ويراجع المشرفون النطاقات الزمنية المتغيّرة فقط. يشمل أيضاً التشغيل دون إنترنت وتقدّم الرفع عند النشر.

---

## Kurdish (ku)

وانەکانی تەختە سپی لە ئەندرۆید لە وردەکاریی کۆرس بە باشی دەکرێنەوە، لەگەڵ پاشخانى PDF. مامۆستایان دەتوانن وانەی بڵاوکراوە دەستکاری بکەن؛ بەڕێوەبەران تەنها کاتە گۆڕاوەکان پێداچوونەوە دەکەن. هەروەها بینینی ئۆفلاین و پێشکەوتنی بارکردن لە کاتی بڵاوکردنەوە.

---

## Turkish (tr)

Tahta dersleri Android’de kurs detayında (PDF arka planlılar dahil) güvenilir açılır. Öğretmenler yayınlanmış tahta derslerini düzenleyebilir; yöneticiler yalnızca değişen zaman aralıklarını inceler. Çevrimdışı oynatma ve yayın yükleme ilerlemesi de dahildir.

---

## Changelog (internal)

- Bump to 1.0.20 (build 22) for Google Play
- Fix Android course-detail whiteboard crash (pdfx/PdfRenderer Unknown error)
- Harden PDF underlay: serialized access, openFile, capped render — never block playback
- Whiteboard edit + ranged admin approval (web + mobile)
