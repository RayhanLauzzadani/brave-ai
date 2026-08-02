# Gemini Dataset Evaluation

Runner ini mengevaluasi classifier Gemini secara offline menggunakan dataset video
berlabel. Runner memakai prompt, model, FPS, dan jalur `GeminiVideoClassifier` yang
sama dengan worker deteksi production. Runner tidak mengirim incident event, tidak
menulis PostgreSQL, dan tidak membutuhkan Redis, API, atau MediaMTX.

"Offline" berarti terpisah dari alur Live Camera dan database production. Full run
tetap mengunggah klip evaluasi ke Gemini, jadi pastikan dataset memiliki izin
penggunaan yang sesuai.

## Struktur Dataset

Dataset lokal tidak disimpan di Git:

```text
datasets/brave-ai/
  bullying/
    *.mp4
  non-bullying/
    *.mp4
```

Ekstensi yang diterima adalah `mp4`, `mov`, `mkv`, `avi`, dan `webm`. Folder label
harus memakai nama `bullying` dan `non-bullying`.

Metadata Drive saat ini berisi 84 sumber video di folder `bullying` dan satu
sumber di folder `non-bullying`. Folder menjadi ground truth resmi sesuai
penyusunan dataset. Setelah segmentasi, benchmark menghasilkan 86 klip bullying
dan 28 klip non-bullying, total 114 klip.

File anotasi di `datasets/brave-ai/.annotations/` hanya merupakan artefak review
lokal dan tidak dipakai oleh benchmark resmi. Opsi `--annotations-file` tetap
tersedia apabila suatu benchmark lain membutuhkan label manual per segmen.

Video non-bullying yang hanya berasal dari satu sumber membuat metrik bersifat
indikatif, bukan bukti akurasi production.

Unduh dataset Drive secara manual ke mesin evaluator. Contoh dengan `gdown`:

```powershell
python -m pip install gdown
gdown --folder "https://drive.google.com/drive/folders/18HUASWzuoOLMCEOs5e_6xEzdsGu069jX?usp=drive_link" -O datasets/brave-ai
```

Jika Google Drive menghentikan unduhan massal, ulangi command dengan `--continue`
atau unduh file yang tertinggal melalui browser yang sudah login. Jangan mengganti
label hanya agar jumlah dataset terlihat lengkap.

Setelah unduhan, pastikan isi akhirnya berada tepat di dua folder label di atas.
Jangan commit video atau API key.

## Prasyarat Lokal

Pastikan `ffmpeg` dan `ffprobe` tersedia di `PATH`. Dari root repository:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ..
```

Salin `backend/.env.example` ke `backend/.env`, lalu isi `GEMINI_API_KEY`
hanya di environment lokal atau secret manager. Jangan menulis key ke report.

Command Python di bawah dijalankan dari folder `backend` supaya `backend/.env`
dibaca otomatis oleh konfigurasi aplikasi.

## Dry Run

Dry run hanya memeriksa folder, durasi, file rusak, dan segmentasi. Tidak ada
request Gemini:

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m app.evaluation.dataset_runner --dataset-dir ..\datasets\brave-ai --output-dir ..\docs\ai-evaluation --dry-run
Pop-Location
```

Aturan segmentasi:

- Video 3 sampai 6 detik menjadi satu klip 3 detik dari bagian tengah.
- Video lebih dari 6 detik dipotong menjadi jendela 3 detik tanpa overlap.
- Sisa kurang dari 3 detik diabaikan.
- Video 1 sampai kurang dari 3 detik dipanjangkan dengan frame terakhir.
- Video kurang dari 1 detik atau tanpa video dicatat sebagai error.

Video 4 detik menghasilkan satu klip tengah. Video 87 detik menghasilkan 29
klip. Normalisasi benchmark memakai H.264 tanpa audio pada 10 FPS.

## Pilot dan Full Run

Pilot tiga klip per label:

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m app.evaluation.dataset_runner --dataset-dir ..\datasets\brave-ai --output-dir ..\docs\ai-evaluation --threshold 0.75 --limit-per-label 3
Pop-Location
```

Full run:

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m app.evaluation.dataset_runner --dataset-dir ..\datasets\brave-ai --output-dir ..\docs\ai-evaluation --threshold 0.75 --run-id folder-label-benchmark-20260801 --resume
Pop-Location
```

Default concurrency adalah 1 untuk mengurangi risiko rate limit. Run yang
terputus dapat dilanjutkan dengan `--resume`; hasil classified yang sudah ada
di cache tidak dikirim ulang. Cache berubah jika hash video, model, prompt, atau
FPS berubah.

Threshold production tetap 0.75. Runner hanya membandingkan threshold dan tidak
mengubah konfigurasi worker.

## Docker Compose

Evaluator memiliki profile terpisah dan tidak dijalankan oleh stack normal:

```powershell
docker compose --env-file backend/.env -f docker-compose.backend.yml --profile evaluation run --rm ai-evaluator --dry-run
docker compose --env-file backend/.env -f docker-compose.backend.yml --profile evaluation run --rm ai-evaluator --limit-per-label 3
docker compose --env-file backend/.env -f docker-compose.backend.yml --profile evaluation run --rm ai-evaluator
```

Service memakai image backend yang sudah berisi FFmpeg, me-mount dataset
read-only, dan menulis report ke `docs/ai-evaluation/`.

## Output

Setiap run membuat:

```text
docs/ai-evaluation/
  latest-summary.md
  runs/<run-id>/
    manifest.json
    summary.json
    results.csv
    raw-results.jsonl
    report.md
```

`summary.json` memiliki schema version `ai-evaluation.v2` dan metrik machine
readable: TP, TN, FP, FN, accuracy, precision, recall, F1, specificity,
processing/evaluation coverage, sumber label, threshold sweep 0.50 sampai 0.95, jumlah request, dan cache hit.
`results.csv` berisi satu baris per klip. `raw-results.jsonl` menyimpan respons
terstruktur classifier untuk audit dan resume.

Folder `runs/` di-ignore Git karena dapat berisi nama file dan observasi video.
Commit hanya README dan ringkasan aman. Tambahkan sumber non-bullying yang
independen sebelum memakai metrik untuk keputusan production.