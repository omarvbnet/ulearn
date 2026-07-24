# U Learn — What's New

**Version:** 1.0.19 (build 21)  
**Date:** 2026-07-24

Use the localized text below for App Store Connect / Google Play “What’s New”.

---

## English (en-US)

Whiteboard lessons work offline after you reopen the app. Teachers see upload progress with percentages when publishing a finished board lesson. Also includes PDF annotate on boards, fullscreen zoom playback, and subscriber alerts when new courses or lessons go live.

---

## Arabic (ar-SA)

دروس السبورة تعمل دون إنترنت حتى بعد إعادة فتح التطبيق. يرى المعلمون نسبة مئوية لتقدّم الرفع عند نشر درس اللوحة. يشمل أيضاً الرسم على PDF، والعرض بملء الشاشة مع التكبير، وإشعارات المشتركين عند نشر دورات أو دروس جديدة.

---

## Kurdish (ku)

وانەکانی تەختە سپی دوای دووبارە کردنەوەی ئەپەکەش ئۆفلاین کاردەکەن. مامۆستایان لە کاتی بڵاوکردنەوەی وانەی تەختە ڕێژەی سەدی بارکردن دەبینن. هەروەها کێشان لەسەر PDF، بینینی شاشەی تەواو لەگەڵ زووم، و ئاگادارکردنەوەی کڕیاران لە کۆرس/وانەی نوێ.

---

## Turkish (tr)

Tahta dersleri uygulamayı yeniden açtıktan sonra da çevrimdışı çalışır. Öğretmenler bitmiş tahta dersini yayınlarken yüzde olarak yükleme ilerlemesini görür. PDF üzerine çizim, tam ekran yakınlaştırma ve yeni kurs/ders bildirimleri de dahildir.

---

## Changelog (internal)

- Bump CFBundleShortVersionString to 1.0.19 (build 21) for App Store
- Offline boards survive app relaunch (cached session + relative paths + My Courses fallback)
- Teacher whiteboard publish: percentage upload progress overlay
- putBytes streams chunks so upload % updates smoothly
