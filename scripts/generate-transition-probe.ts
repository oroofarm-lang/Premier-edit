/**
 * One-off probe: writes a 2-clip FCP7 XML with a video Cross Dissolve and an
 * audio Cross Fade transition at the join, so the user can test-import it
 * into their real Premiere and report whether the transitions survive.
 * See docs/superpowers/specs/2026-07-30-editing-quality-design.md, "Audio
 * smoothing at cut boundaries."
 *
 * Usage: npx tsx scripts/generate-transition-probe.ts <clipA.mp4> <clipB.mp4>
 * Requires two real video files with audio, at least 3 seconds each.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const [clipAPath, clipBPath] = process.argv.slice(2);
if (!clipAPath || !clipBPath) {
  console.error("Usage: npx tsx scripts/generate-transition-probe.ts <clipA> <clipB>");
  process.exit(1);
}

const FPS = 25;
const CLIP_SEC = 3;
const OVERLAP_SEC = 0.5; // half-second transition, easy to see and hear on import

function frames(sec: number): number {
  return Math.round(sec * FPS);
}

function toFileUrl(filePath: string): string {
  return `file://localhost${encodeURI(path.resolve(filePath))}`;
}

const clipAFrames = frames(CLIP_SEC);
const clipBFrames = frames(CLIP_SEC);
const overlapFrames = frames(OVERLAP_SEC);
const totalFrames = clipAFrames + clipBFrames - overlapFrames;

const rate = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>transition-probe</name>
    <duration>${totalFrames}</duration>
    ${rate}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            ${rate}
            <width>1080</width>
            <height>1920</height>
          </samplecharacteristics>
        </format>
        <track>
          <clipitem id="clipitem-video-1">
            <name>clipA</name>
            <enabled>TRUE</enabled>
            <duration>${clipAFrames}</duration>
            ${rate}
            <start>0</start>
            <end>${clipAFrames}</end>
            <in>0</in>
            <out>${clipAFrames}</out>
            <file id="file-1">
              <name>clipA</name>
              <pathurl>${toFileUrl(clipAPath)}</pathurl>
              ${rate}
              <duration>${clipAFrames}</duration>
              <media>
                <video><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></video>
                <audio><channelcount>2</channelcount></audio>
              </media>
            </file>
          </clipitem>
          <transitionitem>
            <name>Cross Dissolve</name>
            <effectid>Cross Dissolve</effectid>
            <start>${clipAFrames - overlapFrames}</start>
            <end>${clipAFrames}</end>
            <alignment>end</alignment>
            <effect>
              <name>Cross Dissolve</name>
              <effectid>Cross Dissolve</effectid>
              <effectcategory>Dissolve</effectcategory>
              <effecttype>transition</effecttype>
              <mediatype>video</mediatype>
            </effect>
          </transitionitem>
          <clipitem id="clipitem-video-2">
            <name>clipB</name>
            <enabled>TRUE</enabled>
            <duration>${clipBFrames}</duration>
            ${rate}
            <start>${clipAFrames - overlapFrames}</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${clipBFrames}</out>
            <file id="file-2">
              <name>clipB</name>
              <pathurl>${toFileUrl(clipBPath)}</pathurl>
              ${rate}
              <duration>${clipBFrames}</duration>
              <media>
                <video><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></video>
                <audio><channelcount>2</channelcount></audio>
              </media>
            </file>
          </clipitem>
        </track>
      </video>
      <audio>
        <track>
          <clipitem id="clipitem-audio-1">
            <name>clipA</name>
            <enabled>TRUE</enabled>
            <duration>${clipAFrames}</duration>
            ${rate}
            <start>0</start>
            <end>${clipAFrames}</end>
            <in>0</in>
            <out>${clipAFrames}</out>
            <file id="file-1"/>
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
          <transitionitem>
            <name>Constant Power</name>
            <effectid>Constant Power</effectid>
            <start>${clipAFrames - overlapFrames}</start>
            <end>${clipAFrames}</end>
            <alignment>end</alignment>
            <effect>
              <name>Constant Power</name>
              <effectid>Constant Power</effectid>
              <effectcategory>Crossfade</effectcategory>
              <effecttype>transition</effecttype>
              <mediatype>audio</mediatype>
            </effect>
          </transitionitem>
          <clipitem id="clipitem-audio-2">
            <name>clipB</name>
            <enabled>TRUE</enabled>
            <duration>${clipBFrames}</duration>
            ${rate}
            <start>${clipAFrames - overlapFrames}</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${clipBFrames}</out>
            <file id="file-2"/>
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`;

const outPath = path.join("exports", `transition-probe-${Date.now()}.xml`);
writeFileSync(outPath, xml, "utf-8");
console.log(`Wrote ${outPath}`);
console.log("Import this into Premiere and check: does the video show a");
console.log("cross-dissolve and does the audio cross-fade at the join, or");
console.log("does Premiere show a hard cut with no transition?");
