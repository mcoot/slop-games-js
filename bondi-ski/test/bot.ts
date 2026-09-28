import type { PlayerController } from "@slop/fps-controller";
import type { CourseData } from "../src/course/data";
import { yawOf } from "../src/course/route";
import type { Jetpack } from "../src/jetpack";
import type { BotCommand } from "./harness";

/**
 * A simple skier for tests: heads for a point on the walk a little ahead, runs to get
 * going, skis once moving (braking before bends), and jets when the way ahead climbs.
 */
export function skiBot(course: CourseData, jet: Jetpack) {
  let w = 0;
  return (player: PlayerController): BotCommand => {
    const p = player.feet;
    let best = Infinity;
    for (let k = Math.max(0, w - 40); k < Math.min(course.path.length, w + 40); k++) {
      const d = Math.hypot(course.path[k]![0] - p.x, course.path[k]![2] - p.z);
      if (d < best) {
        best = d;
        w = k;
      }
    }
    const target = course.path[Math.min(w + 10, course.path.length - 1)]!;
    const speed = player.horizontalSpeed;
    const climbing = target[1] > p.y + 1.5;
    const yaw = yawOf(target[0] - p.x, target[2] - p.z);
    // Going the wrong way fast (say, towards the cliff edge on a bend): stop skiing, so
    // friction brakes and the ground lets you steer.
    const heading = yawOf(player.velocity.x, player.velocity.z);
    const error = Math.abs(Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)));
    // A bend coming up: how far the walk turns over the next 30 m or so.
    const a = course.path[Math.min(w + 4, course.path.length - 1)]!;
    const b = course.path[Math.min(w + 16, course.path.length - 1)]!;
    const bend = Math.abs(Math.atan2(Math.sin(yawOf(b[0] - a[0], b[2] - a[2]) - yaw), Math.cos(yawOf(b[0] - a[0], b[2] - a[2]) - yaw)));
    const brake = (speed > 14 && error > 0.5) || (speed > 11 && bend > 0.7);
    const wantJet = !brake && climbing && jet.energy > (jet.active ? 0.02 : 0.3);
    // Slow on the flat: run to get going (skiing only steers).
    const downhill = target[1] < p.y - 1;
    // Drifting off the walk (the ground falls away towards the sea): dig in and steer back.
    const ski = !brake && best < 3 && (speed > 6.5 || downhill);
    return { forward: 1, ski, jet: wantJet, yaw };
  };
}
