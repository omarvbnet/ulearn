import { WhiteboardEngine } from "../src/services/classroom-engine/services/whiteboard-engine";

const r = WhiteboardEngine.execute(
  [
    {
      op: "write",
      text: "المجال = 2×10^3 نيوتن/كولوم وهذا مقدار كبير جداً في الفيزياء",
      color: "green",
    },
    { op: "write", text: "الشحنة = 2×10^-9 كولوم", color: "blue" },
    { op: "draw_circle", count: 3, color: "red" },
  ] as never,
  { speechLanguage: "ar", cursorY: 160 }
);
for (const a of r.actions) console.log(a.action, JSON.stringify(a.parameters));

const ink = WhiteboardEngine.ensureTeachingInk(
  [],
  "الاستاذ اركان البندر فيزياء",
  "ar"
);
console.log("teacher-name topic became:", JSON.stringify(ink[0].parameters));
