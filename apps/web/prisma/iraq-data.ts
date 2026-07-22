/** Iraq governorates and Iraqi K-12 / secondary stages for seeding. */

export const IRAQ_PROVINCES = [
  { nameEn: "Baghdad", nameAr: "بغداد", nameKu: "بەغدا", nameTr: "Bağdat" },
  { nameEn: "Basra", nameAr: "البصرة", nameKu: "بەسرە", nameTr: "Basra" },
  { nameEn: "Nineveh", nameAr: "نينوى", nameKu: "نەینەوا", nameTr: "Ninova" },
  { nameEn: "Erbil", nameAr: "أربيل", nameKu: "هەولێر", nameTr: "Erbil" },
  { nameEn: "Sulaymaniyah", nameAr: "السليمانية", nameKu: "سلێمانی", nameTr: "Süleymaniye" },
  { nameEn: "Duhok", nameAr: "دهوك", nameKu: "دهۆک", nameTr: "Duhok" },
  { nameEn: "Kirkuk", nameAr: "كركوك", nameKu: "کەرکووک", nameTr: "Kerkük" },
  { nameEn: "Anbar", nameAr: "الأنبار", nameKu: "ئەنبار", nameTr: "Anbar" },
  { nameEn: "Diyala", nameAr: "ديالى", nameKu: "دیالە", nameTr: "Diyala" },
  { nameEn: "Saladin", nameAr: "صلاح الدين", nameKu: "سەلاحەدین", nameTr: "Selahaddin" },
  { nameEn: "Babil", nameAr: "بابل", nameKu: "بابل", nameTr: "Babil" },
  { nameEn: "Karbala", nameAr: "كربلاء", nameKu: "کەربەلا", nameTr: "Kerbela" },
  { nameEn: "Najaf", nameAr: "النجف", nameKu: "نەجەف", nameTr: "Necef" },
  { nameEn: "Wasit", nameAr: "واسط", nameKu: "واسیت", nameTr: "Vasıt" },
  { nameEn: "Maysan", nameAr: "ميسان", nameKu: "مەیسان", nameTr: "Maysan" },
  { nameEn: "Dhi Qar", nameAr: "ذي قار", nameKu: "ذی قار", nameTr: "Zi Kar" },
  { nameEn: "Muthanna", nameAr: "المثنى", nameKu: "موسنە", nameTr: "Muthanna" },
  { nameEn: "Qadisiyyah", nameAr: "القادسية", nameKu: "قادسیە", nameTr: "Kadisiye" },
] as const;

export const IRAQ_EDUCATIONAL_STAGES = [
  { nameEn: "1st Primary", nameAr: "الأول ابتدائي", nameKu: "یەکەم ئابتدایی", nameTr: "1. İlkokul", sortOrder: 1 },
  { nameEn: "2nd Primary", nameAr: "الثاني ابتدائي", nameKu: "دووەم ئابتدایی", nameTr: "2. İlkokul", sortOrder: 2 },
  { nameEn: "3rd Primary", nameAr: "الثالث ابتدائي", nameKu: "سێیەم ئابتدایی", nameTr: "3. İlkokul", sortOrder: 3 },
  { nameEn: "4th Primary", nameAr: "الرابع ابتدائي", nameKu: "چوارەم ئابتدایی", nameTr: "4. İlkokul", sortOrder: 4 },
  { nameEn: "5th Primary", nameAr: "الخامس ابتدائي", nameKu: "پێنجەم ئابتدایی", nameTr: "5. İlkokul", sortOrder: 5 },
  { nameEn: "6th Primary", nameAr: "السادس ابتدائي", nameKu: "شەشەم ئابتدایی", nameTr: "6. İlkokul", sortOrder: 6 },
  { nameEn: "1st Intermediate", nameAr: "الاول متوسط", nameKu: "یەکەم ناوەندی", nameTr: "1. Ortaokul", sortOrder: 7 },
  { nameEn: "2nd Intermediate", nameAr: "الثاني متوسط", nameKu: "دووەم ناوەندی", nameTr: "2. Ortaokul", sortOrder: 8 },
  { nameEn: "3rd Intermediate", nameAr: "الثالث متوسط", nameKu: "سێیەم ناوەندی", nameTr: "3. Ortaokul", sortOrder: 9 },
  { nameEn: "4th Scientific", nameAr: "الرابع العلمي", nameKu: "چوارەم زانستی", nameTr: "4. Fen Lisesi", sortOrder: 10 },
  { nameEn: "5th Scientific", nameAr: "الخامس العلمي", nameKu: "پێنجەم زانستی", nameTr: "5. Fen Lisesi", sortOrder: 11 },
  { nameEn: "6th Scientific", nameAr: "السادس العلمي", nameKu: "شەشەم زانستی", nameTr: "6. Fen Lisesi", sortOrder: 12 },
  { nameEn: "4th Literary", nameAr: "الرابع ادبي", nameKu: "چوارەم ئەدەبی", nameTr: "4. Edebiyat", sortOrder: 13 },
  { nameEn: "5th Literary", nameAr: "الخامس ادبي", nameKu: "پێنجەم ئەدەبی", nameTr: "5. Edebiyat", sortOrder: 14 },
  { nameEn: "6th Literary", nameAr: "السادس ادبي", nameKu: "شەشەم ئەدەبی", nameTr: "6. Edebiyat", sortOrder: 15 },
] as const;

/** Professional certificates track — used as an educational stage for KB + courses. */
export const IRAQ_CERTIFICATE_STAGE = {
  nameEn: "Professional Certificates",
  nameAr: "الشهادات المهنية",
  nameKu: "بڕوانامە پیشەییەکان",
  nameTr: "Mesleki Sertifikalar",
  sortOrder: 100,
  isCertificateTrack: true,
} as const;

/** Areas of interest under the Professional Certificates stage. */
export const CERTIFICATE_INTEREST_SUBJECTS = [
  { nameEn: "Electric", nameAr: "الكهرباء", nameKu: "کارەبا", nameTr: "Elektrik", sortOrder: 1 },
  { nameEn: "Fiber Networks", nameAr: "شبكات الألياف", nameKu: "تۆڕی فایبەر", nameTr: "Fiber Ağlar", sortOrder: 2 },
  { nameEn: "Smart Home", nameAr: "المنزل الذكي", nameKu: "ماڵی زیرا", nameTr: "Akıllı Ev", sortOrder: 3 },
  { nameEn: "Civil", nameAr: "المدني", nameKu: "مەدەنی", nameTr: "İnşaat", sortOrder: 4 },
  { nameEn: "HSE", nameAr: "الصحة والسلامة والبيئة", nameKu: "تەندروستی و سەلامەتی", nameTr: "İSG", sortOrder: 5 },
  { nameEn: "Programming", nameAr: "البرمجة", nameKu: "بەرنامەسازی", nameTr: "Programlama", sortOrder: 6 },
  { nameEn: "Mechanical", nameAr: "الميكانيك", nameKu: "میکانیک", nameTr: "Mekanik", sortOrder: 7 },
  { nameEn: "Cooling and Heating", nameAr: "التبريد والتدفئة", nameKu: "ساردکردنەوە و گەرمکردنەوە", nameTr: "Soğutma ve Isıtma", sortOrder: 8 },
] as const;

/** Stage-agnostic teaching specialties (max 3 per teacher profile). */
export const TEACHER_SPECIALTY_SUBJECTS = [
  { nameEn: "Mathematics", nameAr: "الرياضيات", nameKu: "بیرکاری", nameTr: "Matematik", sortOrder: 1 },
  { nameEn: "Chemistry", nameAr: "الكيمياء", nameKu: "کیمیا", nameTr: "Kimya", sortOrder: 2 },
  { nameEn: "Physics", nameAr: "الفيزياء", nameKu: "فیزیا", nameTr: "Fizik", sortOrder: 3 },
  { nameEn: "Biology", nameAr: "الأحياء", nameKu: "زیندەزانی", nameTr: "Biyoloji", sortOrder: 4 },
  { nameEn: "Arabic", nameAr: "اللغة العربية", nameKu: "زمانی عەرەبی", nameTr: "Arapça", sortOrder: 5 },
  { nameEn: "English", nameAr: "اللغة الإنجليزية", nameKu: "زمانی ئینگلیزی", nameTr: "İngilizce", sortOrder: 6 },
  { nameEn: "History", nameAr: "التاريخ", nameKu: "مێژوو", nameTr: "Tarih", sortOrder: 7 },
  { nameEn: "Geography", nameAr: "الجغرافيا", nameKu: "جوگرافیا", nameTr: "Coğrafya", sortOrder: 8 },
  { nameEn: "Computer Science", nameAr: "علوم الحاسوب", nameKu: "زانستی کۆمپیوتەر", nameTr: "Bilgisayar Bilimi", sortOrder: 9 },
  { nameEn: "Islamic Studies", nameAr: "التربية الإسلامية", nameKu: "پەروەردەی ئیسلامی", nameTr: "İslam Eğitimi", sortOrder: 10 },
] as const;
