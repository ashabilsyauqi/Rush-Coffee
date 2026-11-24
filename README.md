# Rush Coffee — HPP Counter

Aplikasi web untuk menghitung HPP (Harga Pokok Penjualan) per cup: bahan baku, resep, kemasan, overhead, saran harga, BEP, dan simulasi kenaikan harga. Data tersimpan di server Windows dan bisa dipakai bersama dari Mac, HP, atau PC lain.

## Cara cepat (tanpa install)
Ekstrak folder ini ke Desktop, lalu **klik dua kali `BUKA-HPP.html`**. Aplikasi langsung terbuka di browser.
Di mode ini data tersimpan di browser komputer tersebut — rutin klik *Pengaturan → Download backup*.

Untuk dipakai **bersama dari banyak perangkat** (Mac, HP, PC), pasang versi server di Windows (lihat di bawah). Backup dari mode lokal bisa di-import ke versi server.

## Update ke versi baru (data tetap aman)
1. (Disarankan) Buka aplikasi → Pengaturan → **Download backup**.
2. Hapus/timpa folder lama dengan folder versi baru.
3. Klik dua kali `BUKA-HPP.html` — data lama otomatis muncul (data disimpan di Chrome, bukan di folder).
Jika data tidak muncul (mis. ganti browser), pakai Pengaturan → **Import backup**.

## Isi folder
| File | Fungsi |
|---|---|
| `BUKA-HPP.html` | Klik dua kali untuk langsung memakai aplikasi (mode lokal). |
| `INSTALL.bat` | Install / update / ganti password. Klik dua kali (minta izin Admin). |
| `RESTART.bat` | Restart server setelah update file. |
| `START-MANUAL.bat` | Jalankan server di jendela (untuk tes & lihat error). |
| `UNINSTALL.bat` | Hapus service & firewall rule. Data tidak dihapus. |
| `server.js` | Server web (Node.js, tanpa dependency). |
| `public/` | Tampilan aplikasi. Taruh logo resmi sebagai `public/logo.png` agar tampil di header. |
| `seed.json` | Data contoh awal (harga perkiraan — silakan ganti). |
| `data/` | Dibuat otomatis: `data.json` + backup harian 30 hari di `data/backups/`. |

## Install di server Windows (DESKTOP-MTH08V2)
1. Copy folder ini ke server, mis. `C:\RushCoffee\hpp\` (jangan di Desktop/Downloads user agar service SYSTEM bisa akses).
2. Klik dua kali **INSTALL.bat** → setujui izin Administrator.
3. Ikuti prompt: port (default `8080`) dan password login.
   - Jika Node.js belum ada, installer mencoba `winget`. Kalau gagal, install Node.js LTS dari nodejs.org lalu jalankan INSTALL.bat lagi.
4. Installer otomatis: membuat service auto-start saat boot (Task Scheduler `RushCoffee-HPP`, restart sendiri jika crash) dan membuka firewall **hanya untuk LAN + Tailscale**.

## Akses
| Jalur | URL |
|---|---|
| Tailscale (disarankan, dari mana saja) | http://100.99.120.23:8080 |
| Wi-Fi / LAN yang sama | http://192.168.1.104:8080 |
| Di server itu sendiri | http://localhost:8080 |

IP publik (182.253.54.102) **sengaja tidak dibuka**. Aplikasi memakai HTTP biasa, jadi jangan port-forward di router; pakai Tailscale untuk akses dari luar. Tip: di Tailscale aktifkan MagicDNS agar bisa buka `http://desktop-mth08v2:8080`.

## Update aplikasi
Timpa `server.js`, `public/`, dan `seed.json` dengan versi baru (folder `data/` dan `config.json` jangan ditimpa), lalu klik **RESTART.bat**.

## Ganti password
Jalankan **INSTALL.bat** lagi, atau edit `config.json` lalu **RESTART.bat**.

## Cara hitung
- **Biaya per satuan bahan** = harga beli ÷ (isi kemasan × yield%)
- **HPP bahan** = Σ takaran × biaya per satuan (bahan + kemasan)
- **Overhead / cup** = total biaya operasional bulanan ÷ target cup per bulan
- **HPP / cup** = HPP bahan + overhead/cup (overhead bisa dimatikan di menu Biaya Operasional)
- **Food cost %** = HPP bahan ÷ harga jual
- **Saran harga** = HPP bahan ÷ target food cost %, dibulatkan ke atas
- **Harga ojol** = harga jual ÷ (1 − komisi %)
- **BEP** = total overhead ÷ margin kontribusi rata-rata tertimbang (pakai “porsi penjualan %” tiap menu)

## Troubleshooting
- **Tidak bisa dibuka dari Mac:** pastikan Tailscale aktif di kedua perangkat, lalu cek di server: `http://localhost:8080`. Jika di server jalan tapi dari Mac tidak, jalankan INSTALL.bat lagi (membuat ulang firewall rule).
- **Lihat error:** jalankan UNINSTALL.bat, lalu START-MANUAL.bat untuk melihat log di jendela.
- **Kembalikan data lama:** copy salah satu file dari `data\backups\` menjadi `data\data.json`, lalu RESTART.bat. Atau pakai menu Pengaturan → Import backup.
