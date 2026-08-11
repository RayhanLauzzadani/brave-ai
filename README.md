# BRAVE AI

BRAVE AI adalah aplikasi pemantauan kamera sekolah untuk membantu mendeteksi indikasi bullying fisik, meninjau rekaman, dan mencatat hasil pemeriksaan oleh pihak sekolah.

Aplikasi ini dibuat sebagai MVP untuk lomba. Raspberry Pi bertugas mengirim tayangan kamera, server menampilkan dan menyimpan rekaman, lalu Gemini membantu memberi tanda ketika terdapat gerakan yang diduga sebagai bullying fisik. Hasil AI tidak langsung dianggap benar. Admin sekolah atau Guru BK tetap harus memeriksa videonya dan memilih **Bullying** atau **Bukan Bullying**.

Alamat aplikasi yang sudah dipasang di VPS:

```text
https://brave-ai.web.id
```

Jika hanya ingin memakai BRAVE AI sebagai pengguna sekolah, baca bagian **Panduan Penggunaan Sehari-hari**, **Memahami Rekaman dan Indikasi**, serta **Memasang BRAVE AI di HP**. Bagian instalasi laptop, Raspberry Pi, Gemini, dan VPS ditujukan untuk tim yang menyiapkan project.

## Daftar Isi

1. [Gambaran Singkat](#gambaran-singkat)
2. [Siapa yang Menggunakan BRAVE AI](#siapa-yang-menggunakan-brave-ai)
3. [Cara Kerja Aplikasi](#cara-kerja-aplikasi)
4. [Panduan Penggunaan Sehari-hari](#panduan-penggunaan-sehari-hari)
5. [Memahami Rekaman dan Indikasi](#memahami-rekaman-dan-indikasi)
6. [Memasang BRAVE AI di HP](#memasang-brave-ai-di-hp)
7. [Persiapan Demo Lomba](#persiapan-demo-lomba)
8. [Menjalankan Proyek di Laptop](#menjalankan-proyek-di-laptop)
9. [Menghubungkan Raspberry Pi](#menghubungkan-raspberry-pi)
10. [Mengaktifkan Gemini](#mengaktifkan-gemini)
11. [Memasang Proyek di VPS](#memasang-proyek-di-vps)
12. [Teknologi yang Digunakan](#teknologi-yang-digunakan)
13. [Bagaimana Project Ini Dibangun](#bagaimana-project-ini-dibangun)
14. [Struktur Folder](#struktur-folder)
15. [Pengujian Project](#pengujian-project)
16. [Penyelesaian Masalah](#penyelesaian-masalah)
17. [Data dan Keamanan](#data-dan-keamanan)
18. [Batasan MVP](#batasan-mvp)

---

## Gambaran Singkat

BRAVE AI menyatukan beberapa kebutuhan sekolah dalam satu aplikasi:

- Melihat kamera sekolah secara langsung.
- Menampilkan status apakah kamera sudah terhubung.
- Merekam tayangan kamera secara otomatis.
- Menyimpan rekaman maksimal per sesi 24 jam.
- Menyimpan rekaman yang sudah selesai selama 7 hari.
- Memberi tanda merah pada waktu yang diduga terdapat bullying fisik.
- Membunyikan notifikasi di aplikasi untuk Admin dan Guru BK.
- Membuka video di sekitar waktu indikasi agar mudah diperiksa.
- Meminta manusia menentukan apakah kejadian benar-benar bullying.
- Menampilkan kejadian yang sudah dikonfirmasi pada halaman Laporan.

Pengguna sekolah tidak perlu mengetahui istilah seperti RTSP, HLS, WebRTC, atau MediaMTX. Pengguna cukup menambahkan kamera, menjalankan perintah yang diberikan aplikasi pada Raspberry Pi, lalu memakai menu **Live Camera**, **Rekaman**, dan **Laporan**.

## Siapa yang Menggunakan BRAVE AI

Sistem memiliki dua jenis akun.

| Akun | Kegunaan | Hak Akses |
| --- | --- | --- |
| Admin sekolah | Menyiapkan dan mengelola sistem kamera | Melihat kamera, menambah kamera, mengubah nama/lokasi, menghapus kamera, melihat rekaman, menyimpan klip, memeriksa indikasi, dan melihat laporan |
| Guru BK | Memantau dan memeriksa kejadian | Melihat kamera, melihat rekaman, menerima notifikasi, memeriksa indikasi, serta memilih Bullying atau Bukan Bullying |

Admin dan Guru BK sama-sama dapat memvalidasi indikasi. Sistem tidak menunggu persetujuan dua orang sekaligus. Konfirmasi pertama yang berhasil akan disimpan beserta nama akun dan waktu pemeriksaannya.

## Cara Kerja Aplikasi

Alur sederhananya adalah sebagai berikut:

```text
Kamera
  -> Raspberry Pi mengirim tayangan
  -> Server BRAVE AI menerima tayangan
  -> Live Camera menampilkan video
  -> Sistem menyimpan rekaman otomatis
  -> Gemini memeriksa potongan video pendek
  -> Indikasi muncul sebagai tanda merah dan notifikasi
  -> Admin atau Guru BK menonton ulang kejadian
  -> Pengguna memilih Bullying atau Bukan Bullying
  -> Kejadian yang dikonfirmasi masuk ke Laporan
```

Raspberry Pi hanya menjadi penghubung antara kamera dan server. Proses penyimpanan, tampilan video, notifikasi, AI, validasi, serta laporan dilakukan oleh sistem BRAVE AI.

Gemini memeriksa potongan video sekitar 3 detik secara berkala. Fokus sistem saat ini hanya **bullying atau agresi fisik**, misalnya memukul, menendang, mendorong, menjambak, menarik paksa, mencekik, memojokkan, atau gestur fisik agresif lainnya.

## Panduan Penggunaan Sehari-hari

### 1. Masuk ke aplikasi

1. Buka `https://brave-ai.web.id`.
2. Masukkan email akun sekolah.
3. Masukkan password.
4. Tekan tombol **Masuk**.

Akun pengembangan lokal:

```text
Admin sekolah
Email    : admin@braveai.school
Password : password

Guru BK
Email    : gurubk@braveai.school
Password : password
```

Password production mengikuti pengaturan rahasia di VPS dan tidak harus sama dengan password pengembangan.

### 2. Mengenal menu utama

| Menu | Kegunaan |
| --- | --- |
| Live Camera | Melihat tayangan langsung, status kamera, timeline, serta indikasi terbaru |
| Rekaman | Melihat rekaman kamera yang sudah selesai diproses |
| Laporan | Melihat indikasi yang masih perlu diperiksa dan kejadian yang sudah dikonfirmasi |
| Pengaturan/Settings | Memasang PWA, mengatur suara notifikasi, dan keluar dari akun |

Pada HP, menu tersedia pada navigasi bagian bawah. Pada laptop, menu tersedia pada sidebar kiri.

### 3. Menambahkan kamera sebagai Admin

1. Buka menu **Live Camera**.
2. Tekan **Tambah Kamera** pada bagian Daftar Kamera.
3. Isi **Nama Kamera**. Contoh: `Koridor Lantai 2`.
4. Isi **Lokasi**. Contoh: `Gedung A, lantai 2`.
5. Tekan **Lanjutkan**.
6. Aplikasi membuat jalur kamera secara otomatis.
7. Tekan **Copy & Tutup** untuk menyalin perintah Raspberry Pi.
8. Jalankan perintah tersebut pada Raspberry Pi yang terhubung ke kamera.
9. Kembali ke Live Camera dan tekan **Aktifkan Kamera** untuk memeriksa koneksi.

Tombol **Aktifkan Kamera** tidak menyalakan listrik Raspberry Pi. Tombol tersebut meminta aplikasi memeriksa kembali apakah tayangan dari Raspberry Pi sudah sampai ke server.

### 4. Mengubah nama atau lokasi kamera

1. Buka **Live Camera**.
2. Cari kamera pada Daftar Kamera.
3. Tekan ikon titik tiga pada kamera.
4. Pilih **Ubah Nama & Lokasi**.
5. Ubah nama atau lokasi.
6. Simpan perubahan.

Perubahan nama tidak mengganti jalur koneksi Raspberry Pi. Kamera tetap memakai sambungan yang sudah dibuat sebelumnya.

### 5. Menghapus kamera

1. Tekan ikon titik tiga pada kamera.
2. Pilih **Hapus Kamera**.
3. Periksa kembali nama kamera.
4. Tekan **Hapus**.

Menghapus kamera dari daftar tidak dimaksudkan untuk menghapus file rekaman yang sudah tersimpan.

### 6. Melihat kamera langsung

1. Pilih salah satu kamera dari Daftar Kamera.
2. Tunggu status pemeriksaan koneksi selesai.
3. Jika Raspberry Pi terhubung, video muncul otomatis.
4. Gunakan tombol play atau pause untuk mengatur tayangan di perangkat yang sedang digunakan.
5. Gunakan tombol suara jika sumber kamera mendukung audio.
6. Gunakan tombol layar penuh untuk memperbesar video.

Konfigurasi standar Raspberry Pi pada project ini mengirim video tanpa audio. Karena itu tombol suara dapat tetap terlihat tetapi tidak menghasilkan suara pada kamera tersebut.

Status yang mungkin terlihat:

| Status | Arti |
| --- | --- |
| Memeriksa koneksi | Aplikasi sedang mencari tayangan kamera |
| Live | Tayangan kamera sedang diterima |
| Paused | Tayangan dijeda pada perangkat pengguna, tetapi kamera tidak dimatikan |
| Menunggu Raspberry Pi | Belum ada tayangan yang diterima dari perangkat kamera |
| Offline | Kamera atau sambungan sedang tidak tersedia |

### 7. Menggunakan timeline Live Camera

Saat kamera live, posisi timeline berada di sisi paling kanan. Posisi tersebut berarti pengguna sedang melihat tayangan terbaru.

Pengguna dapat menggeser timeline ke kiri untuk melihat beberapa menit sebelumnya. Kamera tetap merekam di belakang layar. Tekan label **LIVE** untuk kembali ke tayangan terbaru.

Titik merah pada timeline menunjukkan waktu ketika sistem menerima indikasi bullying fisik.

### 8. Membuka indikasi

1. Tekan notifikasi atau item pada bagian **Indikasi Terbaru**.
2. Sistem memilih kamera yang sesuai.
3. Sistem mencari rekaman pada waktu kejadian.
4. Video Trimmer terbuka di sekitar waktu indikasi.
5. Titik atau garis merah menunjukkan waktu indikasi.
6. Tekan play dan tonton gerakannya dengan teliti.
7. Geser posisi putih jika ingin melihat detik lainnya.
8. Pilih **Bullying** jika kejadian benar-benar merupakan bullying fisik.
9. Pilih **Bukan Bullying** jika hasil AI tidak sesuai.

Jika kamera sudah mati, sistem mencoba memakai rekaman yang sudah tersedia. Jika arsip sudah selesai dibuat, pengguna diarahkan ke halaman Rekaman pada kamera dan waktu yang sesuai.

### 9. Memahami Video Trimmer

Video Trimmer digunakan untuk menonton ulang dan memilih bagian video.

| Bagian | Kegunaan |
| --- | --- |
| Garis putih | Posisi video yang sedang diputar |
| Tanda merah | Waktu indikasi dari AI |
| Pegangan awal | Menentukan awal klip |
| Pegangan akhir | Menentukan akhir klip |
| Mulai dan Selesai | Menampilkan jam awal serta akhir klip |
| Ekspor & Simpan | Membuat file klip baru dari bagian yang dipilih, khusus Admin |

Trimmer secara awal menyiapkan area sekitar kejadian, yaitu hingga 30 detik sebelum dan 30 detik sesudah indikasi apabila videonya tersedia. Pemilihan tersebut belum otomatis disimpan. Admin tetap dapat menggeser awal dan akhir klip sebelum menekan **Ekspor & Simpan**.

Jika video belum selesai dimuat, akan muncul tulisan **Menyiapkan rekaman...**. Jika proses terlalu lama atau sumber tidak tersedia, tekan **Muat Ulang**.

### 10. Memvalidasi indikasi

Pilihan validasi mempunyai arti berikut:

| Pilihan | Hasil |
| --- | --- |
| Bullying | Indikasi dikonfirmasi, tanda merah tetap digunakan, dan satu laporan dibuat |
| Bukan Bullying | Indikasi tetap disimpan sebagai riwayat pemeriksaan, tetapi tidak masuk laporan bullying |

Jika Admin dan Guru BK menekan **Bullying** pada indikasi yang sama, sistem tetap membuat satu laporan saja.

### 11. Membuka halaman Laporan

Halaman Laporan memisahkan kejadian berdasarkan hasil pemeriksaan:

- **Perlu Diperiksa** untuk indikasi yang belum diputuskan.
- **Bullying** untuk indikasi yang sudah dikonfirmasi.
- **Bukan Bullying** untuk indikasi yang dinyatakan bukan kejadian bullying.

Laporan menampilkan informasi sederhana seperti kamera, lokasi, waktu, keterangan AI, dan hasil pemeriksaan. Fokus MVP adalah memastikan sekolah dapat mengetahui apakah terdapat bullying atau tidak.

### 12. Keluar dari akun

1. Buka menu **Settings**.
2. Cari bagian akun.
3. Tekan **Keluar dari Akun**.
4. Aplikasi kembali ke halaman login.

## Memahami Rekaman dan Indikasi

### Kapan rekaman mulai dibuat?

Rekaman dibuat otomatis selama kamera mengirim tayangan. Pengguna tidak perlu menekan tombol rekam.

### Kapan rekaman muncul di halaman Rekaman?

Sistem menyelesaikan satu rekaman ketika:

- Kamera berhenti mengirim tayangan; atau
- Kamera terus menyala dan satu sesi sudah mencapai maksimal 24 jam.

Setelah itu server menggabungkan dan mengompres video. Rekaman pendek biasanya membutuhkan sekitar 1 sampai 3 menit untuk muncul. Rekaman yang panjang dapat memerlukan waktu lebih lama, tergantung kemampuan VPS.

Halaman Rekaman memeriksa data baru secara berkala. Pengguna dapat menekan **Muat Ulang** jika ingin memeriksa lagi secara langsung.

### Berapa lama rekaman disimpan?

Rekaman final disimpan selama 7 hari sejak selesai dibuat. Klip bukti MVP juga disimpan selama 7 hari. Setelah masa simpan berakhir, sistem dapat membersihkannya secara otomatis.

### Bagaimana indikasi terlihat di Rekaman?

Rekaman yang memiliki indikasi menampilkan badge merah beserta jumlah indikasi. Setelah rekaman dipilih, timeline detail menampilkan titik merah pada waktu kejadian. Titik merah juga tetap terlihat ketika tombol **Lihat** membuka video layar penuh.

Jika video sudah diputar pada Detail Rekaman Terpilih lalu pengguna menekan **Lihat**, video layar penuh melanjutkan posisi yang sama dan tidak kembali ke awal.

### Apa yang terjadi jika kamera mati setelah indikasi muncul?

Indikasi tidak hilang ketika kamera mati. Sistem menyimpan data indikasi di database. Ketika pengguna menekan indikasi:

1. Sistem mencari arsip rekaman yang mencakup waktu kejadian.
2. Jika arsip sudah siap, sistem membuka halaman Rekaman pada waktu tersebut.
3. Jika arsip belum siap tetapi potongan mentah masih ada, sistem mencoba menampilkan potongan tersebut.
4. Jika keduanya belum tersedia, pengguna mendapat informasi bahwa rekaman masih diproses.

## Memasang BRAVE AI di HP

BRAVE AI adalah PWA. Artinya, aplikasi dapat dipasang ke layar utama HP dan dibuka seperti aplikasi biasa tanpa mengunduhnya dari Play Store atau App Store.

### Android dengan Chrome

1. Buka `https://brave-ai.web.id` menggunakan Chrome.
2. Login ke BRAVE AI.
3. Buka menu **Settings**.
4. Tekan **Install Aplikasi** jika tombol tersedia.
5. Jika tombol belum tersedia, tekan menu tiga titik Chrome.
6. Pilih **Install app** atau **Tambahkan ke layar utama**.
7. Tekan **Install**.

### iPhone dengan Safari

1. Buka `https://brave-ai.web.id` menggunakan Safari.
2. Login ke BRAVE AI.
3. Tekan tombol **Share** pada Safari.
4. Pilih **Add to Home Screen** atau **Tambahkan ke Layar Utama**.
5. Tekan **Add**.

### Mengaktifkan suara notifikasi

Browser dapat menahan suara sampai pengguna berinteraksi dengan halaman.

1. Buka **Settings**.
2. Aktifkan **Suara Notifikasi**.
3. Jika muncul tombol **Aktifkan Suara**, tekan tombol tersebut sekali.
4. Pastikan volume HP atau laptop tidak sedang mute.

Notifikasi suara saat ini bekerja ketika BRAVE AI sedang terbuka. MVP belum mengirim push notification ketika aplikasi benar-benar ditutup.

## Persiapan Demo Lomba

Gunakan daftar berikut sebelum presentasi:

- [ ] VPS dapat dibuka melalui `https://brave-ai.web.id`.
- [ ] Akun Admin dapat login.
- [ ] Akun Guru BK dapat login pada perangkat berbeda.
- [ ] Raspberry Pi menyala dan kameranya terdeteksi.
- [ ] Kamera muncul dengan status Live.
- [ ] Video dapat dibuka pada laptop dan HP.
- [ ] Suara notifikasi sudah diaktifkan pada kedua akun.
- [ ] AI worker berjalan dan mempunyai Gemini API key.
- [ ] Gerakan uji fisik dapat membuat indikasi.
- [ ] Tanda merah terlihat pada timeline.
- [ ] Indikasi dapat membuka Video Trimmer.
- [ ] Admin atau Guru BK dapat memilih Bullying atau Bukan Bullying.
- [ ] Kejadian Bullying muncul pada Laporan.
- [ ] Kamera dapat dimatikan dan rekaman muncul setelah diproses.
- [ ] Ruang penyimpanan VPS masih cukup.
- [ ] Database sudah dicadangkan sebelum demo.

Gunakan gerakan simulasi yang aman. Jangan melakukan pukulan sungguhan kepada peserta demo.

---

## Menjalankan Proyek di Laptop

Bagian ini ditujukan untuk anggota tim yang menyiapkan atau mengembangkan project.

### 1. Yang perlu dipasang

Pastikan laptop memiliki:

- Git.
- Docker Desktop.
- Node.js versi 22.
- npm.
- Browser Chrome atau Edge terbaru.

Python lokal hanya diperlukan jika ingin menjalankan backend tanpa Docker atau menjalankan test backend secara langsung.

### 2. Mengambil project dari GitHub

Buka PowerShell pada folder tempat project akan disimpan:

```powershell
git clone https://github.com/RayhanLauzzadani/brave-ai.git brave-ai-cctv
cd brave-ai-cctv
```

Jika project sudah ada:

```powershell
cd E:\ilungdokumen\Project\brave-ai-cctv
git pull origin main
```

### 3. Menyiapkan pengaturan backend

Dari folder utama project:

```powershell
Copy-Item backend\.env.example backend\.env
```

Buka `backend/.env`, lalu isi bagian berikut jika AI ingin digunakan:

```dotenv
GEMINI_API_KEY=masukkan_api_key_gemini
AI_DETECTION_ENABLED=true
INCIDENT_INGEST_TOKEN=brave-local-demo-token
```

Jangan menuliskan API key ke source code, README, screenshot, atau commit Git. File `.env` memang disiapkan agar tidak ikut Git.

Untuk menjalankan aplikasi tanpa AI, biarkan:

```dotenv
AI_DETECTION_ENABLED=false
```

### 4. Menjalankan backend, database, dan layanan kamera

Pastikan Docker Desktop sudah terbuka dan berstatus running.

Jalankan perintah berikut dari folder utama project, bukan dari folder `backend`:

```powershell
docker compose -f docker-compose.backend.yml up -d --build
```

Perintah tersebut menyalakan:

- API BRAVE AI.
- PostgreSQL untuk menyimpan akun, kamera, indikasi, notifikasi, dan laporan.
- Redis untuk kebutuhan pesan cepat.
- MediaMTX untuk menerima serta menayangkan video.
- Worker rekaman untuk membuat arsip.
- Worker AI untuk memeriksa potongan video.

Terapkan struktur database:

```powershell
docker compose -f docker-compose.backend.yml exec api alembic upgrade head
```

Buat akun Admin dan Guru BK:

```powershell
docker compose -f docker-compose.backend.yml exec api python -m app.db.seed
```

Periksa apakah layanan berjalan:

```powershell
docker compose -f docker-compose.backend.yml ps
```

Backend lokal tersedia di:

```text
http://localhost:8000
http://localhost:8000/docs
```

### 5. Menyiapkan frontend

Buka PowerShell baru:

```powershell
cd E:\ilungdokumen\Project\brave-ai-cctv
Copy-Item frontend\.env.example frontend\.env.local
cd frontend
npm install
npm run dev
```

Buka:

```text
http://localhost:3000
```

Penting: project tidak mempunyai `package.json` di folder utama. Perintah `npm install` dan `npm run dev` harus dijalankan dari folder `frontend`.

### 6. Login lokal

Gunakan:

```text
admin@braveai.school / password
gurubk@braveai.school / password
```

### 7. Membuka aplikasi dari HP pada WiFi yang sama

Jalankan frontend dengan akses jaringan:

```powershell
cd frontend
npm run dev:lan
```

Terminal menampilkan alamat Network, misalnya:

```text
http://192.168.1.10:3000
```

Buka alamat tersebut dari HP yang terhubung ke WiFi yang sama.

Untuk pengujian kamera HP atau izin kamera browser, gunakan HTTPS lokal:

```powershell
cd frontend
npm run dev:https
```

Jika alamat IP yang dipilih script tidak sesuai:

```powershell
$env:LAN_HOST="192.168.1.10"
npm run dev:https
```

Sertifikat lokal dibuat sendiri sehingga browser mungkin menampilkan peringatan. Production menggunakan HTTPS resmi dan tidak mengalami peringatan tersebut.

### 8. Menguji dengan webcam laptop

Tombol webcam hanya tersedia dalam mode development dan tidak ditampilkan pada production.

1. Login sebagai Admin.
2. Tambahkan satu kamera.
3. Pilih kamera tersebut.
4. Tekan **Uji dengan Webcam**.
5. Izinkan browser menggunakan kamera.
6. Tunggu tayangan muncul.

Webcam ini hanya untuk menguji alur sebelum Raspberry Pi tersedia. Alur final tetap memakai kamera yang terhubung ke Raspberry Pi.

### 9. Menghentikan aplikasi lokal

Hentikan frontend dengan menekan `Ctrl + C` pada terminal frontend.

Hentikan Docker dari folder utama:

```powershell
docker compose -f docker-compose.backend.yml down
```

Jangan menambahkan `-v` jika data PostgreSQL masih dibutuhkan. Opsi `-v` akan menghapus volume database lokal.

## Menghubungkan Raspberry Pi

### Perangkat yang dibutuhkan

- Raspberry Pi dengan Raspberry Pi OS atau sistem berbasis Debian.
- Kamera USB atau kamera yang terbaca sebagai `/dev/video0`.
- Koneksi internet atau jaringan menuju VPS.
- Akses terminal Raspberry Pi.

### Alur pemasangan paling mudah

1. Login sebagai Admin.
2. Buka **Live Camera**.
3. Tekan **Tambah Kamera**.
4. Isi nama dan lokasi.
5. Tekan **Lanjutkan**.
6. Tekan **Copy & Tutup**.
7. Buka terminal Raspberry Pi.
8. Tempel perintah yang disalin.
9. Tekan Enter dan tunggu pemasangan selesai.
10. Kembali ke Live Camera.
11. Pilih kamera dan tekan **Aktifkan Kamera**.

Contoh bentuk perintah yang dibuat aplikasi:

```bash
curl -fsSL https://brave-ai.web.id/pi/install.sh | sudo bash -s -- --media-path camera-xxxxxx --rtsp-host brave-ai.web.id --asset-base https://brave-ai.web.id/pi
```

Jangan menyalin contoh tersebut secara manual untuk kamera nyata. Gunakan perintah yang dibuat oleh tombol **Tambah Kamera** karena setiap kamera memiliki kode sambungan berbeda.

### Memeriksa Raspberry Pi

Periksa apakah kamera terdeteksi:

```bash
v4l2-ctl --list-devices
```

Periksa layanan kamera:

```bash
systemctl status brave-pi-publisher
```

Lihat pesan yang sedang berjalan:

```bash
journalctl -u brave-pi-publisher -f
```

Mulai ulang sambungan kamera:

```bash
sudo systemctl restart brave-pi-publisher
```

Pengaturan Raspberry Pi tersimpan di:

```text
/etc/brave-ai-camera.env
```

Panduan teknis lebih lengkap tersedia di [docs/raspberry-pi-publisher-kit.md](docs/raspberry-pi-publisher-kit.md).

## Mengaktifkan Gemini

### Apa yang dilakukan Gemini?

Gemini menerima potongan video pendek dari server. Gemini mengembalikan:

- Ringkasan gerakan yang terlihat.
- Analisis kontak fisik.
- Nilai keyakinan dari 0 sampai 1.
- Prediksi `bullying` atau `non-bullying`.
- Alasan singkat.

Sistem membuat indikasi hanya jika hasilnya `bullying` dan nilai keyakinan melewati batas yang ditentukan. Nilai bawaan saat ini adalah `0.75`.

### Mengaktifkan AI lokal

Isi `backend/.env`:

```dotenv
GEMINI_API_KEY=masukkan_api_key_gemini
AI_DETECTION_ENABLED=true
AI_DETECTION_CONFIDENCE_THRESHOLD=0.75
INCIDENT_INGEST_TOKEN=brave-local-demo-token
```

Bangun ulang layanan AI dan API:

```powershell
docker compose -f docker-compose.backend.yml up -d --build api ai-worker
```

Lihat aktivitas AI:

```powershell
docker compose -f docker-compose.backend.yml logs -f ai-worker
```

### Jika indikasi tidak muncul

Periksa hal berikut:

- Kamera benar-benar berstatus Live.
- `AI_DETECTION_ENABLED=true`.
- `GEMINI_API_KEY` sudah diisi dan masih aktif.
- `INCIDENT_INGEST_TOKEN` terisi.
- Container `ai-worker` berjalan.
- Gerakan terlihat cukup jelas di dalam frame.
- Gerakan termasuk kontak fisik atau agresi fisik.
- Batas confidence tidak terlalu tinggi.

AI dapat salah membaca gerakan bercanda, olahraga, atau objek yang tertutup. Karena itu keputusan akhir selalu dilakukan oleh Admin atau Guru BK.

### Evaluasi dataset

Dataset digunakan untuk mengukur prompt dan model secara offline. Dataset tidak menjadi sumber notifikasi Live Camera.

Panduan tersedia di [docs/ai-evaluation/README.md](docs/ai-evaluation/README.md).

## Memasang Proyek di VPS

Bagian ini untuk pengelola server. Pengguna sekolah tidak perlu melakukan langkah ini.

### 1. Siapkan domain

Arahkan DNS domain ke alamat IP VPS menggunakan record `A`.

Untuk project ini:

```text
Domain : brave-ai.web.id
VPS    : 148.230.103.197
```

### 2. Siapkan file pengaturan production

Di VPS, buat:

```text
/opt/brave-ai-cctv/.env.production
```

Isi minimal:

```dotenv
APP_HOST=brave-ai.web.id
POSTGRES_PASSWORD=ganti_dengan_password_database_yang_kuat
SECRET_KEY=ganti_dengan_kunci_aplikasi_yang_panjang
ADMIN_PASSWORD=ganti_dengan_password_admin
VIEWER_PASSWORD=ganti_dengan_password_guru_bk
GEMINI_API_KEY=masukkan_api_key_gemini
INCIDENT_INGEST_TOKEN=ganti_dengan_token_panjang
AI_DETECTION_ENABLED=true
```

Batasi file agar tidak mudah dibaca akun lain:

```bash
chmod 600 /opt/brave-ai-cctv/.env.production
```

### 3. Menjalankan stack production

```bash
cd /opt/brave-ai-cctv
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api alembic upgrade head
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api python -m app.db.seed
```

Caddy mengurus HTTPS secara otomatis setelah domain mengarah ke VPS dan port 80 serta 443 dapat diakses.

### 4. Deployment otomatis dari GitHub

Setiap push ke branch `main` menjalankan pemeriksaan project lalu mengirim versi terbaru ke VPS.

Repository GitHub memerlukan secrets berikut:

```text
VPS_HOST
VPS_USER
VPS_SSH_KEY
APP_DIR
```

Nilai project saat ini:

```text
VPS_HOST = 148.230.103.197
VPS_USER = root
APP_DIR  = /opt/brave-ai-cctv
```

Password database, password akun, Gemini API key, dan secret aplikasi tetap berada pada `.env.production` di VPS. Jangan memasukkannya ke repository.

Panduan VPS yang lebih teknis tersedia di [deploy/README_VPS.md](deploy/README_VPS.md).

## Teknologi yang Digunakan

| Bagian | Teknologi | Kegunaan Sederhana |
| --- | --- | --- |
| Tampilan web | Next.js 16, React 19, TypeScript | Membuat halaman Live Camera, Rekaman, Laporan, Login, dan Settings |
| PWA | Next PWA | Memasang aplikasi ke layar utama HP |
| Backend | FastAPI, Python | Mengatur login, kamera, rekaman, indikasi, notifikasi, dan laporan |
| Database | PostgreSQL | Menyimpan data penting secara permanen |
| Pesan cepat | Redis | Menyiapkan kebutuhan komunikasi cepat antarproses |
| Penghubung video | MediaMTX | Menerima tayangan Raspberry Pi dan menyiapkannya untuk browser |
| Pengolahan video | FFmpeg dan FFprobe | Memotong, menggabungkan, memeriksa, dan mengompres video |
| AI | Gemini | Membantu mengklasifikasikan bullying fisik dari potongan video |
| Server web | Caddy | Menyediakan domain, HTTPS, dan mengarahkan permintaan aplikasi |
| Container | Docker Compose | Menjalankan semua bagian project dengan konfigurasi yang sama |
| Deployment | GitHub Actions | Memeriksa dan mengirim versi terbaru ke VPS |

## Bagaimana Project Ini Dibangun

Project dipisahkan menjadi beberapa bagian agar setiap bagian mempunyai tugas yang jelas:

1. **Frontend** menampilkan antarmuka yang digunakan Admin dan Guru BK.
2. **Backend** menerima permintaan dari frontend dan menerapkan aturan hak akses.
3. **PostgreSQL** menyimpan akun, kamera, indikasi, notifikasi, rekaman, hasil validasi, dan laporan.
4. **MediaMTX** menerima tayangan Raspberry Pi dan membuat tayangan tersebut dapat dibaca browser.
5. **Recording worker** mengubah segmen kecil menjadi arsip rekaman maksimal 24 jam.
6. **AI worker** mengambil potongan 3 detik dan meminta Gemini melakukan klasifikasi.
7. **Caddy** menyatukan semuanya di bawah domain HTTPS yang sama.

Pemisahan ini membuat bagian kamera, AI, tampilan, dan database dapat diperbaiki tanpa harus membongkar seluruh aplikasi.

## Struktur Folder

```text
brave-ai-cctv/
  backend/                  FastAPI, database, AI worker, dan recording worker
  frontend/                 Next.js PWA dan seluruh tampilan pengguna
  media/                    Konfigurasi MediaMTX dan file video lokal
  datasets/                 Dataset evaluasi Gemini, tidak ikut Git
  docs/                     Dokumentasi evaluasi AI dan Raspberry Pi
  deploy/                   Caddy, backup, pemeriksaan storage, dan panduan VPS
  .github/workflows/        Pemeriksaan otomatis dan deployment
  docker-compose.backend.yml
  docker-compose.prod.yml
  README.md
```

Folder video berikut tidak boleh dimasukkan ke Git:

```text
media/recordings/
media/archives/
media/clips/
media/hls/
datasets/
```

## Pengujian Project

### Frontend

```powershell
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest tests
.\.venv\Scripts\python.exe -m ruff check app tests
```

### Docker Compose

Jalankan dari folder utama:

```powershell
docker compose -f docker-compose.backend.yml config --quiet

$env:APP_HOST="brave-ai.web.id"
$env:POSTGRES_PASSWORD="compose-check-only"
$env:SECRET_KEY="compose-check-only"
$env:ADMIN_PASSWORD="compose-check-only"
$env:VIEWER_PASSWORD="compose-check-only"
docker compose -f docker-compose.prod.yml config --quiet
```

Nilai `compose-check-only` di atas hanya dipakai untuk memeriksa bentuk file Compose pada terminal lokal. Nilai tersebut bukan password production dan tidak boleh dipakai untuk memasang aplikasi sungguhan.

Pengujian dianggap selesai jika tidak ada error. Warning lama dari library dapat ditinjau terpisah selama tidak menggagalkan proses.

## Penyelesaian Masalah

### `npm run dev` mengatakan tidak ada `package.json`

Penyebabnya adalah perintah dijalankan dari folder utama.

```powershell
cd frontend
npm run dev
```

### Docker Compose mengatakan file tidak ditemukan

Jalankan perintah dari folder utama project:

```powershell
cd E:\ilungdokumen\Project\brave-ai-cctv
docker compose -f docker-compose.backend.yml up -d --build
```

### Port 3000 sudah digunakan

Cari proses yang memakai port:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

Hentikan PID yang ditampilkan jika proses tersebut memang server lama:

```powershell
taskkill /PID NOMOR_PID /F
```

Lalu jalankan kembali `npm run dev`.

### Login selalu gagal

Jalankan migration dan seed:

```powershell
docker compose -f docker-compose.backend.yml exec api alembic upgrade head
docker compose -f docker-compose.backend.yml exec api python -m app.db.seed
```

Pastikan container API dan PostgreSQL berstatus running.

### Kamera terus menampilkan Menunggu Raspberry Pi

1. Pastikan Raspberry Pi menyala.
2. Pastikan kamera terdeteksi di Raspberry Pi.
3. Jalankan `systemctl status brave-pi-publisher`.
4. Jalankan `journalctl -u brave-pi-publisher -f`.
5. Pastikan perintah Raspberry Pi berasal dari kamera yang sedang dipilih.
6. Pastikan port `8554` VPS tidak diblokir firewall.
7. Tekan **Aktifkan Kamera** untuk memeriksa ulang.

### Video Live Camera terlambat

Live Camera mengutamakan jalur video cepat dan mempunyai jalur cadangan. Keterlambatan dapat berasal dari koneksi Raspberry Pi, jaringan sekolah, beban VPS, atau proses cadangan video.

Periksa koneksi Raspberry Pi dan log MediaMTX. Hindari membuka terlalu banyak publisher untuk kamera yang sama.

### Indikasi bullying tidak muncul

```powershell
docker compose -f docker-compose.backend.yml logs -f ai-worker
```

Periksa API key, status AI, koneksi kamera, dan nilai confidence. AI hanya diarahkan untuk bullying fisik.

### Notifikasi muncul tetapi tidak berbunyi

1. Buka Settings.
2. Aktifkan Suara Notifikasi.
3. Tekan Aktifkan Suara jika ditampilkan.
4. Pastikan browser tidak memblokir suara.
5. Pastikan volume perangkat aktif.

### Trimmer kembali ke awal atau lama dimuat

Versi terbaru mempertahankan posisi seek dan mencoba kembali ketika video sudah siap. Tunggu tulisan **Menyiapkan rekaman...** selesai. Jika muncul error, tekan **Muat Ulang**.

Jika masih gagal, sumber rekaman mungkin belum selesai dibuat atau sudah melewati masa simpan 7 hari.

### Rekaman belum muncul setelah kamera mati

Worker perlu menggabungkan dan mengompres video terlebih dahulu. Tunggu beberapa menit lalu tekan **Muat Ulang**.

Periksa worker:

```powershell
docker compose -f docker-compose.backend.yml logs -f recording-worker
```

### Production menampilkan versi lama

1. Periksa GitHub Actions pada commit terakhir.
2. Pastikan job Validate dan Deploy berhasil.
3. Periksa container VPS.
4. Muat ulang browser tanpa cache.

```bash
cd /opt/brave-ai-cctv
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

## Data dan Keamanan

- API key Gemini hanya disimpan di backend atau VPS.
- Cookie login bersifat HttpOnly agar tidak mudah dibaca JavaScript browser.
- Password production harus berbeda dari password demo.
- Jangan commit file `.env`, dataset, rekaman, arsip, atau klip.
- Jangan menjalankan `docker compose down -v` jika database masih dibutuhkan.
- Lakukan backup PostgreSQL sebelum demo penting.
- Logout setelah menggunakan perangkat umum.
- Pengguna tetap harus memeriksa hasil AI sebelum menyatakan suatu kejadian sebagai bullying.

Untuk backup MVP sebelum lomba:

```bash
cd /opt/brave-ai-cctv
sh deploy/check-storage.sh
sh deploy/backup-postgres.sh
```

## Batasan MVP

- Fokus AI hanya bullying fisik, bukan bullying verbal atau sosial.
- Notifikasi suara bekerja saat aplikasi atau PWA sedang terbuka.
- AI dapat menghasilkan prediksi yang salah.
- Hasil AI selalu memerlukan validasi Admin atau Guru BK.
- Rekaman dan klip MVP disimpan selama 7 hari.
- Kualitas dan keterlambatan video bergantung pada jaringan serta kemampuan VPS.
- Keamanan publisher kamera masih disederhanakan untuk kebutuhan lomba.
- Sistem belum menggantikan prosedur resmi penanganan bullying di sekolah.

## Ringkasan Cepat

Untuk pengguna sekolah:

```text
Login
-> pilih kamera
-> lihat notifikasi atau tanda merah
-> buka indikasi
-> tonton Video Trimmer
-> pilih Bullying atau Bukan Bullying
-> lihat hasil pada Laporan
```

Untuk menjalankan project lokal:

```powershell
# Terminal 1, dari folder utama
docker compose -f docker-compose.backend.yml up -d --build
docker compose -f docker-compose.backend.yml exec api alembic upgrade head
docker compose -f docker-compose.backend.yml exec api python -m app.db.seed

# Terminal 2
cd frontend
npm install
npm run dev
```

Buka `http://localhost:3000`, lalu login menggunakan akun pengembangan.
