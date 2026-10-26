import fs from 'node:fs';
import path from 'node:path';

const plist = path.resolve('ios/App/App/Info.plist');
if (!fs.existsSync(plist)) {
  console.error('iOS project not found. Run `npm run ios:add` on a development machine first.');
  process.exit(1);
}
let xml = fs.readFileSync(plist, 'utf8');
const key = '<key>NSMicrophoneUsageDescription</key>';
if (!xml.includes(key)) {
  const rootDict = xml.indexOf('<dict>');
  if (rootDict < 0) throw new Error('Info.plist has no root <dict> tag.');
  const insertAt = rootDict + '<dict>'.length;
  const entry = '\n    <key>NSMicrophoneUsageDescription</key>\n    <string>InfantCry uses the microphone to record infant cry audio for analysis.</string>\n';
  xml = xml.slice(0, insertAt) + entry + xml.slice(insertAt);
  fs.writeFileSync(plist, xml, 'utf8');
}
console.log('Microphone usage description is present in Info.plist.');
