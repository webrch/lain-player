# LAIN — плеер в стиле Lain Iwakura

Музыкальный плеер для Android: Material You, коричнево-белая палитра, поиск по SoundCloud через токен аккаунта, смена обоев и иконки, плейлисты и управление скоростью воспроизведения.

## Что внутри

- `android/` — исходный проект Android (Kotlin + WebView + JS-мост на OkHttp). Собирается в APK.
- `player-web/` — та же оболочка в виде автономного PWA (можно открыть в браузере / поставить на домашний экран).
- `icons/`, `wallpaper/` — твои исходные ассеты.
- `tools/process_icons.py` — генератор скруглённых иконок, адаптивных слоёв и mipmap-наборов.

## Возможности

- Поиск треков SoundCloud по токену (нативный OkHttp-запрос, без CORS-проблем).
- Плеер: play/pause, следующий/предыдущий, перемотка, перемешивание, повтор, скорость 0.5×–2×.
- Медиатека: любимые треки, недавние, плейлисты (сохраняются в SharedPreferences).
- Три пресета обоев и три пресета иконки приложения. Иконка меняется через `activity-alias` — ярлык на рабочем столе действительно переключается. Обои можно поставить и на рабочий стол.

**Готовый APK: `LAIN.apk` в корне проекта** (debug-сборка, 3 МБ, ставится через `adb install` или просто открытием файла на телефоне).
- Иконки скруглены «как у всех приложений» (squircle + адаптивная иконка для Android 8+).

## Сборка APK

Нужны Android Studio (или JDK 17 + Android SDK 35 + Gradle 8.7).

1. Открой `android/` в Android Studio.
2. Дождись синхронизации Gradle.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. Готовый файл: `android/app/build/outputs/apk/debug/app-debug.apk`.

Из командной строки (при наличии JDK/SDK):

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17"
$env:ANDROID_HOME = "C:\path\to\Android\Sdk"
cd android
.\gradlew assembleDebug
```

## Токен SoundCloud

Настройки → SoundCloud. Токен можно взять из `localStorage` сайта soundcloud.com (ключ `oauth_token`) или получить через OAuth2 своего приложения. Поле **Client ID** необязательно — нужно только для прямого воспроизведения в браузерной версии.

## Веб-версия

```powershell
cd player-web
python -m http.server 8080
```

Открой `http://localhost:8080`. PWA ставится на домашний экран через меню браузера «Установить приложение».
