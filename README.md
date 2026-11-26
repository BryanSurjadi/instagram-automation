# Instagram Story Automation

Drop finished JPG, JPEG, or MP4 files into one private Google Drive folder. GitHub Actions schedules one Story at 10:05 a.m. and one at 2:05 p.m. WIB (03:05 and 07:05 UTC) to avoid the top of the hour. GitHub can delay or drop scheduled runs. Each run randomly selects one eligible file, so consecutive slots can pick the same file. An empty folder skips publishing.

GitHub Pages serves static files. GitHub Actions runs this Node.js job. The small Express app runs on a web host such as Render and streams the selected file from Google Drive to Meta through a signed HTTPS link valid for 15 minutes. Drive stays private and the file is streamed without being copied into a bucket. Your laptop can be off. To drop files through Windows File Explorer, use the same folder through Google Drive for desktop and let it sync before the run.

## Preview with Google Drive

1. Create a Drive folder called **Stories** and upload at least one finished JPG or MP4.
2. In Google Cloud, enable the Google Drive API, create a service account, and create a JSON key for it. Share only the Stories folder with the service account email as **Viewer**.
3. Create a private GitHub repository for this project and push the source to its default branch. Add `DRIVE_SERVICE_ACCOUNT_JSON` as an Actions secret and `DRIVE_STORIES_FOLDER_ID` as an Actions variable. The folder ID is the part of the Drive URL after `/folders/`.
4. In GitHub, open **Actions → Daily Instagram Story → Run workflow**. Leave **Publish to Instagram** unchecked. The log should show the randomly selected file. Dry-run needs Drive credentials only.

For a local preview, use Node 24, run `npm install`, copy `.env.example` to `.env`, and set the same two values. Put the compact service account JSON on one line in `.env`, enclosed in single quotes. Run `npm run story`. Keep `.env` and service account keys out of Git. Run `npm test` for the local checks.

## Deploy the media relay

1. Connect the private repository to a Node.js Web Service on Render or another Express host. Use `npm ci --ignore-scripts` as the build command and `npm start` as the start command. Set the health check path to `/health`.
2. On the relay host, set `DRIVE_SERVICE_ACCOUNT_JSON` to the service account JSON and `MEDIA_SIGNING_KEY` to a random secret. Generate a key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. The relay only needs these two secrets. Store the Instagram token in GitHub Actions.
3. Check that the deployed HTTPS URL returns `200 OK` at `/health`. In GitHub Actions, set `MEDIA_SIGNING_KEY` as a secret with the matching value. Set `MEDIA_BASE_URL` as a variable pointing to the deployed HTTPS origin, for example `https://your-service.onrender.com`. Keep signed media URLs out of logs because anyone who has a valid link can fetch the file until the link expires.

## Connect the Instagram Business account

1. Open the existing **Story Scheduler** app in [Meta for Developers](https://developers.facebook.com/) and authorize `@salonmurahjakarta` through its Unified Login configuration. Check the username in the consent popup before authorizing.
2. Put the matching account ID and token in the local `.env` and set `IG_EXPECTED_USERNAME=salonmurahjakarta`. Run `npm run story -- --verify-account` to check them without publishing. Set `IG_ACCESS_TOKEN` as a GitHub Actions secret and `IG_USER_ID` as a variable. `IG_API_VERSION` defaults to `v27.0`. Track the expiration returned by Meta for the token you use.
3. In GitHub Actions, run a preview with the chosen Drive file ID in `file_id`. For the first hosted live test, set the Actions variable `IG_ALLOW_LIVE=true` and run the workflow with the same `file_id` and **Publish to Instagram** checked. Verify the Story on `@salonmurahjakarta`.
4. Set the Actions variable `IG_SCHEDULE_LIVE=true` to enable live scheduled posting. Scheduled runs preview the folder until enabled. If a live job fails during publication, check the Story or the logged Meta container before starting another live run. GitHub's **Re-run jobs** action cannot publish on a second attempt.

Use 9:16 exports for Stories. Embed any text or audio in the file. Interactive stickers and tracks from Instagram's library require finishing the Story in the app.
