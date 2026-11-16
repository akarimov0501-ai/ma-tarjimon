# MA Tarjimon

Offline English ⇄ O'zbek tarjimon. MA'ning TranslateGemma-4B asosidagi modeli foydalanuvchi kompyuterining o'zida ishlaydi: internet kerak emas, matn hech qayerga yuborilmaydi.

- **Platformalar:** Windows (x64), macOS (Apple Silicon va Intel)
- **Texnologiya:** Tauri 2 + React. Ichida llama.cpp `llama-server` bor.
- **Model:** foydalanuvchi `.gguf` faylni o'zi tanlaydi. Tanlangan model eslab qolinadi va keyingi ochilishda avtomatik yuklanadi.

## Qanday ishlaydi

1. Foydalanuvchi **Model tanlash** tugmasi orqali `.gguf` faylni tanlaydi.
2. Dastur ichidagi `llama-server` shu model bilan `127.0.0.1` dagi bo'sh portda ishga tushadi. Windows'da Vulkan orqali GPU ishlatiladi (NVIDIA/AMD/Intel), Mac'da Metal. "GPU" belgisini olib tashlasa, faqat CPU ishlatiladi.
3. Har bir so'rov model o'qitilgan aynan TranslateGemma formatida yuboriladi (`src-tauri/src/lib.rs` → `build_prompt`). Shuning uchun foydalanuvchi hech qanday prompt yozmaydi.
4. Uzun matn qatorlar va gaplarga bo'linadi (~300 belgidan), har bo'lak alohida tarjima qilinadi va qayta yig'iladi (`src/chunk.ts`). Model bitta gaplar ustida o'qitilgan, shuning uchun bu sifatni saqlaydi va uzun matnda "aylanib qolish"ning oldini oladi.

## 1-qadam: GGUF model tayyorlash (bir marta)

`tools/make_gguf_kaggle.py` ni Kaggle'da ishga tushiring (CPU yetarli). U v2 adapterni base model bilan birlashtiradi, Q8_0 GGUF (~4 GB) yaratadi va uni `translategemma-4b-uzbek-gguf` HF repo'siga yuklaydi.

## 2-qadam: o'rnatuvchilarni yasash (GitHub Actions — Mac kerak emas)

1. Shu papkani GitHub'ga yangi repo qilib yuklang.
2. **Actions → Build installers → Run workflow** ni bosing (`main` ga har push'da ham ishlaydi).
3. ~15–20 daqiqadan keyin **Artifacts** bo'limida quyidagilar paydo bo'ladi:
   - `MA-Tarjimon-windows-x64` → `.exe` o'rnatuvchi
   - `MA-Tarjimon-macos-arm64` → `.dmg` (M1/M2/M3/M4)
   - `MA-Tarjimon-macos-x64` → `.dmg` (Intel Mac)

Workflow llama.cpp'ning eng so'nggi tayyor build'ini yuklab, dastur ichiga joylaydi. Muayyan versiyani qotirish uchun Run workflow oynasida `llama_tag` ni kiriting (masalan, `b6100`).

## Mahalliy ishlab chiqish

Kerak bo'ladi: Node 20+, Rust (stable), Windows'da WebView2 (Windows 11'da bor), Mac'da Xcode Command Line Tools.

```bash
npm install
npm run fetch-llama          # llama-server'ni src-tauri/resources/llama/ ga yuklaydi
npx tauri icon app-icon.png  # ikonkalarni yaratadi (bir marta)
npm run tauri dev            # dasturni ochadi
npm run tauri build          # o'rnatuvchi yasaydi
```

## Ma'lum cheklovlar

- **Imzo yo'q.** Windows SmartScreen "Noma'lum noshir" deb ogohlantiradi ("More info → Run anyway"). Mac'da birinchi ochilishda o'ng tugma → **Open** qilish kerak. Buni yo'qotish uchun Windows code-signing sertifikati va Apple Developer ID ($99/yil) bilan imzolash kerak.
- **Faqat en ⇄ uz.** Model faqat shu ikki yo'nalishda o'qitilgan.
- **Qurilma talabi:** Q8_0 model uchun ~6 GB bo'sh RAM kerak. Zaif kompyuterlar uchun keyinchalik Q5_K_M (~3 GB) varianti tayyorlanishi mumkin.
- **Kodning holati:** prompt formati va matnni bo'lish mantig'i unit-testdan o'tgan. Lekin to'liq ilova hali Windows yoki Mac'da yig'ilib, haqiqiy model bilan sinalmagan. Birinchi GitHub Actions build'i shuni tekshiradi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `src/App.tsx` | Interfeys: ikki oyna, til almashtirish, model tanlash, GPU belgisi |
| `src/chunk.ts` | Uzun matnni bo'laklarga ajratish va qayta yig'ish |
| `src-tauri/src/lib.rs` | `llama-server`ni ishga tushirish/to'xtatish, tarjima so'rovi, prompt formati |
| `scripts/fetch-llama.mjs` | llama.cpp build'ini yuklab olish |
| `.github/workflows/build.yml` | Windows va macOS o'rnatuvchilarini yasash |
| `tools/make_gguf_kaggle.py` | Adapterni birlashtirish va GGUF yaratish (Kaggle) |
