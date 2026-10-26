import fs from 'node:fs';
import path from 'node:path';

const manifest = path.resolve('android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('Android project not found. Run `npm run android:add` first.');
  process.exit(1);
}
let xml = fs.readFileSync(manifest, 'utf8');
const permissions = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.INTERNET'
];
for (const permission of permissions) {
  const escaped = permission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<uses-permission\\s+android:name=["']${escaped}["']\\s*/>`);
  if (!re.test(xml)) {
    const declaration = `    <uses-permission android:name="${permission}" />`;
    const appTag = xml.indexOf('<application');
    const manifestEnd = xml.indexOf('</manifest>');
    const insertAt = appTag >= 0
      ? xml.lastIndexOf('\n', appTag - 1) + 1
      : (manifestEnd >= 0 ? xml.lastIndexOf('\n', manifestEnd - 1) + 1 : -1);
    if (insertAt < 0) throw new Error('AndroidManifest.xml has no valid insertion point.');
    xml = xml.slice(0, insertAt) + declaration + '\n' + xml.slice(insertAt);
  }
}
fs.writeFileSync(manifest, xml, 'utf8');
console.log('Microphone, audio-settings, and internet permissions are present in AndroidManifest.xml.');
