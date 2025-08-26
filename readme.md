# Activity Timer & Exporter (Dev Version)

This Chrome extension lets you:
- Start/stop a timer for activities
- Add a title/description and file attachments
- Export everything into a **ZIP** containing a CSV worksheet + attachment files

⚡ Everything runs **100% client-side**. No data leaves your computer.
<img width="355" height="487" alt="image" src="https://github.com/user-attachments/assets/9ca1920f-17a6-449c-9db9-12c4d59e46ea" />
<img width="331" height="397" alt="image" src="https://github.com/user-attachments/assets/5a661df0-ac93-48ee-a8f9-db1100e41129" />
<img width="1086" height="477" alt="image" src="https://github.com/user-attachments/assets/82a6f09e-830a-4d48-aca3-faa9a2b6622e" />
<img width="1218" height="441" alt="image" src="https://github.com/user-attachments/assets/8dd1793a-a668-497f-898d-6ab25ab97b75" />

---

## Installation (Developer Mode)

1. Clone or download this repo:
   ```bash
   git clone https://github.com/your-username/activity-timer-exporter.git
   cd activity-timer-exporter
   ```

2. Open Chrome and go to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top-right).

4. Click **Load unpacked** and select the `activity-timer-exporter/` folder.

5. The extension will now appear in your toolbar. Pin it for quick access.

---

## Usage

1. Click the extension icon to open the popup.
2. Enter a **title/description** and optionally upload attachments.
3. Click **Start** to begin timing.
4. When finished, click **Stop**.
5. Open the **Options page** (link in popup) to view all activities.
6. Click **Export ZIP** to download `activity_export.zip` containing:
   - `activities.csv` (with durations in hours)
   - All attachments organized per activity.
7. After export, the activity database is automatically **cleared**.

---

## Folder structure
```
activity-timer-exporter/
  ├─ manifest.json
  ├─ worker.js
  ├─ popup.html
  ├─ popup.js
  ├─ options.html
  └─ options.js
```

---

## Notes
- You can attach files **before** starting a timer. They will be saved in a standalone activity.
- All data is stored locally in **IndexedDB** until you export.
- The extension works offline.

---
