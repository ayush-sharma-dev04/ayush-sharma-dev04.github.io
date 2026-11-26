    // =========================================================================
    // 1. Simulation Configuration & Global Physics State
    // =========================================================================
    const config = {
      numStringNodes: 16,         // Multi-segment Verlet string from center spoke tip to Spider-Man
      numSpokes: 11,              // 11 radial spokes (index 5 = center vertical spoke at 90 deg)
      numRings: 4,                // 4 concentric rings of inward-curving scalloped arches
      pullStrength: 0.80,         // Mouse hover elastic pull multiplier
      webElasticity: 0.68,        // Canopy & string spring stiffness
      gravity: 0.48,              // Downward gravitational acceleration
      damping: 0.985,             // Air resistance / decay damping
      constraintIterations: 16,   // Verlet solver passes for snappy silk tension
      // Layout only: keeps the cobweb anchored inside the right-hand hero column.
      // The physics constants above are untouched from the original simulation.
      apexRatio: 0.72,
      pointerActive: false,
      pointerX: -9999,
      pointerY: -9999,
      prevPointerX: -9999,
      prevPointerY: -9999,
      pointerSpeed: 0,
      lastTouchAt: 0,
      isDraggingSpider: false,
      dragOffsetX: 0,
      dragOffsetY: 0
    };

    let cobweb = null;            // Top-center radial cobweb fan (spokes, rings, spring nodes)
    let stringNodes = [];         // Single hanging Verlet string nodes
    let segmentLength = 16;       // Rest length per string segment

    // Secondary Inertia State for Chibi Spider-Man's Head & Body Jiggle
    let spideyState = {
      angle: 0,
      angularVel: 0,
      headTilt: 0,
      headTiltVel: 0,
      headBob: 0,
      headBobVel: 0,
      tension: 0,
      speed: 0,
      nearCobweb: false,
      nearSpidey: false
    };

    // =========================================================================
    // 2. Verlet Node Class for the Single Hanging Web String
    // =========================================================================
    class StringNode {
      constructor(x, y, pinned = false, isTip = false) {
        this.x = x;
        this.y = y;
        this.oldX = x;
        this.oldY = y;
        this.pinned = pinned;
        this.isTip = isTip;
        this.localTension = 0;
      }

      integrate(gravity, damping, pointerActive, px, py, pullStrength, nodeRatio) {
        if (this.pinned) return;

        // Direct drag when user grabs Spider-Man
        if (this.isTip && config.isDraggingSpider) {
          this.oldX = this.x;
          this.oldY = this.y;
          this.x = px + config.dragOffsetX;
          this.y = py + config.dragOffsetY;
          return;
        }

        const vx = (this.x - this.oldX) * damping;
        const vy = (this.y - this.oldY) * damping;

        this.oldX = this.x;
        this.oldY = this.y;

        // Heavier effective mass at bottom node where Spider-Man hangs
        const massGravity = this.isTip ? gravity * 1.55 : gravity;
        this.x += vx;
        this.y += vy + massGravity;

        // Magnetic / Elastic Hover Pull toward Cursor
        if (pointerActive && !config.isDraggingSpider) {
          const dx = px - this.x;
          const dy = py - this.y;
          const dist = Math.hypot(dx, dy);
          const influenceRadius = Math.max(width, height) * 0.48;

          if (dist < influenceRadius && dist > 3) {
            const falloff = Math.pow(1 - dist / influenceRadius, 1.45);
            const weightFactor = 0.35 + nodeRatio * 1.05;
            const speedBoost = 1 + Math.min(config.pointerSpeed * 0.015, 0.55);
            const coreSmooth = Math.min(dist / 28, 1);
            const pullMag = falloff * pullStrength * 2.25 * weightFactor * speedBoost * coreSmooth;

            this.x += (dx / dist) * pullMag;
            this.y += (dy / dist) * pullMag;
          }
        }
      }
    }

    // =========================================================================
    // 3. Build Top-Center Radial Cobweb Fan & Initialize Drop-and-Jiggle Entry
    // =========================================================================
    function buildTopCenterCobweb() {
      // The stage's top edge is flush with the navbar's bottom edge (see
      // .spider-stage), so the apex starts at y = 0: the web literally begins
      // at the navbar. It is offset to the right of the hero so the character
      // hangs on the right.
      const apexX = width * config.apexRatio;
      const apexY = 0;

      // Responsive fan radii so the semi-circular cobweb frames the hero top
      const centerSpokeLen = constrain(height * 0.24, 120, 200);
      const sideReachX = Math.max(width * 0.36, 260);

      const startDeg = 12;
      const endDeg = 168;
      const spokes = [];

      for (let s = 0; s < config.numSpokes; s++) {
        const tSpoke = s / (config.numSpokes - 1);
        const angleRad = radians(lerp(startDeg, endDeg, tSpoke));
        const dx = Math.cos(angleRad);
        const dy = Math.sin(angleRad);

        // Elliptical envelope so outer spokes sweep gracefully across the wide top edge
        // while the middle vertical spoke (index 5, 90 deg) hangs down cleanly to centerSpokeLen
        const cosAbs = Math.abs(dx);
        const maxLen = lerp(centerSpokeLen, sideReachX, Math.pow(cosAbs, 1.35));

        const nodes = [];
        for (let r = 0; r < config.numRings; r++) {
          // Ring fractions: innermost ring starts near top apex, outer ring (r = 3) forms the scalloped bottom edge
          const ringFrac = lerp(0.24, 1.0, r / (config.numRings - 1));
          const rx = apexX + dx * maxLen * ringFrac;
          const ry = apexY + dy * maxLen * ringFrac;

          nodes.push({
            s,
            r,
            ringFrac,
            baseX: rx,
            baseY: ry,
            x: rx,
            y: ry,
            vx: 0,
            vy: 0
          });
        }

        // Far outer anchor extensions beyond ring 4 on the side spokes so side rays extend off-screen
        const extendLen = maxLen * 1.28;
        spokes.push({
          index: s,
          angleRad,
          nodes,
          outerTipX: apexX + dx * extendLen,
          outerTipY: apexY + dy * extendLen,
          isCenter: s === Math.floor(config.numSpokes / 2)
        });
      }

      cobweb = {
        apexX,
        apexY,
        spokes,
        centerIndex: Math.floor(config.numSpokes / 2),
        outerRingIndex: config.numRings - 1
      };
    }

    function getCenterSpokeTipNode() {
      return cobweb.spokes[cobweb.centerIndex].nodes[cobweb.outerRingIndex];
    }

    function initSimulation(triggerDrop = true) {
      buildTopCenterCobweb();

      const anchorNode = getCenterSpokeTipNode();
      const targetStringLen = constrain(height * 0.26, 150, 250);
      segmentLength = targetStringLen / (config.numStringNodes - 1);

      stringNodes = [];
      for (let i = 0; i < config.numStringNodes; i++) {
        const t = i / (config.numStringNodes - 1);
        const isPinned = i === 0;
        const isTip = i === config.numStringNodes - 1;

        // Start tucked up near the top cobweb apex so Spider-Man drops downward on load!
        const startX = anchorNode.baseX + (triggerDrop ? Math.sin(t * PI) * 10 : 0);
        const startY = triggerDrop
          ? lerp(cobweb.apexY + 26, anchorNode.baseY + 22, t)
          : anchorNode.baseY + t * targetStringLen;

        const node = new StringNode(startX, startY, isPinned, isTip);
        if (isTip && triggerDrop) {
          // Downward drop impulse + subtle lateral sway for an organic jiggle on catch
          node.oldX = startX - 2.6;
          node.oldY = startY - 11.5;
        }
        stringNodes.push(node);
      }

      // Reset Spider-Man secondary jiggle spring
      spideyState.angle = 0;
      spideyState.angularVel = 0;
      spideyState.headTilt = 0;
      spideyState.headTiltVel = 0;
      spideyState.headBob = 0;
      spideyState.headBobVel = 0;
      spideyState.tension = 0;
    }

    // =========================================================================
    // 4. p5.js Lifecycle: setup & draw
    // =========================================================================
    function setup() {
      const container = document.getElementById('canvas-container');
      const w = container ? Math.max(320, Math.floor(container.clientWidth)) : windowWidth;
      const h = container ? Math.max(320, Math.floor(container.clientHeight)) : windowHeight;
      config.apexRatio = isStackedLayout() ? 0.5 : 0.72;

      const c = createCanvas(w, h);
      c.parent('canvas-container');
      pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      initSimulation(true);

      // The stage can change size without the window resizing (for example when
      // the hero reflows), so track its box directly as well.
      if (container && typeof ResizeObserver === 'function') {
        let scheduled = false;
        const observer = new ResizeObserver(() => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const cw = Math.max(320, Math.floor(container.clientWidth));
            const ch = Math.max(320, Math.floor(container.clientHeight));
            if (cw !== width || ch !== height) windowResized();
          });
        });
        observer.observe(container);
      }
    }

    function isStackedLayout() {
      return typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 980px)').matches
        : windowWidth <= 980;
    }

    function draw() {
      // Clear (rather than paint) every frame so the portfolio shows through.
      clear();

      // Track pointer velocity
      if (config.pointerActive) {
        const dx = config.pointerX - config.prevPointerX;
        const dy = config.pointerY - config.prevPointerY;
        config.pointerSpeed = lerp(config.pointerSpeed, Math.hypot(dx, dy), 0.25);
        config.prevPointerX = config.pointerX;
        config.prevPointerY = config.pointerY;
      } else {
        config.pointerSpeed = lerp(config.pointerSpeed, 0, 0.15);
      }

      // 1. Step coupled physics: cobweb spring-mass canopy <-> single hanging Verlet string
      stepCoupledPhysics();

      // 2. Render Top-Center Radial Cobweb Fan with Scalloped Silk Arches
      drawTopCenterCobweb();

      // 3. Render Single Elastic Hanging Web String
      drawSingleHangingString();

      // 4. Render Upside-Down Curled Chibi Spider-Man with Big Forehead
      drawChibiSpiderMan();

      // 5. Render Subtle Radial Cursor Pull Field Indicator
      drawCursorPullRing();
    }

    // =========================================================================
    // 5. Coupled Spring-Mass Cobweb + Verlet String Physics Solver
    // =========================================================================
    function stepCoupledPhysics() {
      if (!cobweb || stringNodes.length < 2) return;

      const centerTip = getCenterSpokeTipNode();

      // Pin top node of hanging string directly to the center spoke's bottom tip
      stringNodes[0].x = centerTip.x;
      stringNodes[0].y = centerTip.y;

      // Integrate single hanging string nodes
      const n = stringNodes.length;
      for (let i = 1; i < n; i++) {
        const ratio = i / (n - 1);
        stringNodes[i].integrate(
          config.gravity,
          config.damping,
          config.pointerActive,
          config.pointerX,
          config.pointerY,
          config.pullStrength,
          ratio
        );
      }

      // Enforce string segment distances
      const stringStiffness = map(config.webElasticity, 0.15, 1.0, 0.36, 0.95);
      for (let i = 0; i < n; i++) stringNodes[i].localTension = 0;

      for (let iter = 0; iter < config.constraintIterations; iter++) {
        for (let i = 0; i < n - 1; i++) {
          const n1 = stringNodes[i];
          const n2 = stringNodes[i + 1];

          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const diff = (dist - segmentLength) / dist;

          if (iter === config.constraintIterations - 1) {
            const stretch = Math.max(0, (dist - segmentLength) / segmentLength);
            n1.localTension = Math.max(n1.localTension, stretch);
            n2.localTension = Math.max(n2.localTension, stretch);
          }

          const corrX = dx * diff * stringStiffness;
          const corrY = dy * diff * stringStiffness;

          if (n1.pinned) {
            n2.x -= corrX;
            n2.y -= corrY;
          } else if (n2.isTip && config.isDraggingSpider) {
            n1.x += corrX * 0.85;
            n1.y += corrY * 0.85;
          } else {
            const w1 = n2.isTip ? 0.65 : 0.5;
            const w2 = 1 - w1;
            n1.x += corrX * w1;
            n1.y += corrY * w1;
            n2.x -= corrX * w2;
            n2.y -= corrY * w2;
          }
        }
      }

      // Keep Spider-Man cleanly inside viewport margins. The lower bound also
      // sits below the web knot: if he is flung above it the strand folds and
      // he can hang there, so the string is never allowed to invert.
      const tip = stringNodes[n - 1];
      const minTipY = centerTip.y + segmentLength * 10;
      tip.x = constrain(tip.x, 60, width - 60);
      tip.y = constrain(tip.y, minTipY, height - 155);

      // Compute downward tug force from the hanging string onto the cobweb's center spoke tip
      const node1 = stringNodes[1];
      const tugDx = node1.x - centerTip.x;
      const tugDy = node1.y - centerTip.y;
      const tugDist = Math.hypot(tugDx, tugDy) || 1;
      const overstretch = Math.max(0, tugDist - segmentLength * 0.72);
      const stringTugX = (tugDx / tugDist) * overstretch * 0.42;
      const stringTugY = (tugDy / tugDist) * overstretch * 0.42;

      // Update spring-mass grid of all cobweb spoke-ring intersection nodes
      const canopySpringK = map(config.webElasticity, 0.15, 1.0, 0.055, 0.16);
      const canopyDamping = 0.80;
      const hoverRadius = Math.max(width, height) * 0.34;
      let nearAnyCobwebNode = false;

      for (let s = 0; s < cobweb.spokes.length; s++) {
        const spoke = cobweb.spokes[s];
        for (let r = 0; r < spoke.nodes.length; r++) {
          const node = spoke.nodes[r];

          // Base spring restoration force toward rest position
          let fx = (node.baseX - node.x) * canopySpringK;
          let fy = (node.baseY - node.y) * canopySpringK;

          // Propagate tug from the center spoke's bottom tip smoothly through neighboring spokes & rings
          const spokeDist = Math.abs(s - cobweb.centerIndex);
          const ringWeight = 0.35 + 0.65 * (r / (config.numRings - 1));
          const neighborFalloff = Math.exp(-spokeDist * 0.52) * ringWeight;
          fx += stringTugX * neighborFalloff;
          fy += stringTugY * neighborFalloff;

          // Mouse hover magnetic elastic pull directly on cobweb nodes
          if (config.pointerActive && !config.isDraggingSpider) {
            const mdx = config.pointerX - node.x;
            const mdy = config.pointerY - node.y;
            const mdist = Math.hypot(mdx, mdy);
            if (mdist < hoverRadius && mdist > 2) {
              nearAnyCobwebNode = true;
              const mFalloff = Math.pow(1 - mdist / hoverRadius, 1.65);
              // Outer rings flex more freely than inner apex rings
              const flexFactor = 0.45 + 0.75 * (r / (config.numRings - 1));
              const mForce = mFalloff * config.pullStrength * 3.1 * flexFactor;
              fx += (mdx / mdist) * mForce;
              fy += (mdy / mdist) * mForce;
            }
          }

          node.vx = (node.vx + fx) * canopyDamping;
          node.vy = (node.vy + fy) * canopyDamping;
          node.x += node.vx;
          node.y += node.vy;
        }
      }

      // Update Spider-Man orientation & spring-damper head jiggle
      const refNode = stringNodes[Math.max(0, n - 4)];
      const tangentX = tip.x - refNode.x;
      const tangentY = tip.y - refNode.y;
      // Clamping the swing keeps him hanging head-down even if the string is
      // dragged above its anchor; without this he flips upright at the poles.
      const targetAngle = constrain(Math.atan2(-tangentX, tangentY), -0.85, 0.85);

      const prevAngle = spideyState.angle;
      spideyState.angle = lerp(spideyState.angle, targetAngle, 0.25);
      const rawAngVel = spideyState.angle - prevAngle;
      spideyState.angularVel = lerp(spideyState.angularVel, rawAngVel, 0.32);

      const tipVx = tip.x - tip.oldX;
      const tipVy = tip.y - tip.oldY;
      spideyState.speed = lerp(spideyState.speed, Math.hypot(tipVx, tipVy), 0.22);

      // Rotational head wobble driven by pendulum swing
      const targetTilt = constrain(-spideyState.angularVel * 5.4, -0.34, 0.34);
      spideyState.headTiltVel += (targetTilt - spideyState.headTilt) * 0.22;
      spideyState.headTiltVel *= 0.80;
      spideyState.headTilt += spideyState.headTiltVel;

      // Vertical bounce/jiggle on drop catch and elastic rebound
      const targetBob = constrain(tipVy * 0.58, -8, 11);
      spideyState.headBobVel += (targetBob - spideyState.headBob) * 0.25;
      spideyState.headBobVel *= 0.78;
      spideyState.headBob += spideyState.headBobVel;

      let avgStretch = 0;
      for (let i = 0; i < n; i++) avgStretch += stringNodes[i].localTension;
      avgStretch /= n;
      spideyState.tension = lerp(spideyState.tension, constrain(avgStretch * 2.4, 0, 1), 0.2);

      const distToSpidey = Math.hypot(config.pointerX - tip.x, config.pointerY - (tip.y + 62));
      spideyState.nearSpidey = config.pointerActive && distToSpidey < 90;
      spideyState.nearCobweb = nearAnyCobwebNode;
    }

    // =========================================================================
    // 6. Renderers: Top-Center Cobweb Fan, Single String & Spider-Man
    // =========================================================================

    function drawTopCenterCobweb() {
      if (!cobweb) return;
      const { apexX, apexY, spokes, outerRingIndex } = cobweb;
      const tensionBoost = spideyState.tension * 35;

      // 1. Draw Radial Spokes from Top-Center Apex through all Ring Intersections
      noFill();
      for (let s = 0; s < spokes.length; s++) {
        const spoke = spokes[s];
        const isCenter = spoke.isCenter;

        // Subtle luminous halo on spokes under stretch
        if (spideyState.tension > 0.04) {
          stroke(248, 250, 252, 16 + spideyState.tension * 36);
          strokeWeight(isCenter ? 3.4 : 2.2);
          beginShape();
          vertex(apexX, apexY);
          for (const rn of spoke.nodes) vertex(rn.x, rn.y);
          if (!isCenter) {
            const last = spoke.nodes[outerRingIndex];
            const ex = last.x + (last.x - spoke.nodes[outerRingIndex - 1].x) * 1.15;
            const ey = last.y + (last.y - spoke.nodes[outerRingIndex - 1].y) * 1.15;
            vertex(ex, ey);
          }
          endShape();
        }

        // Crisp silk spoke line
        stroke(241, 245, 249, (isCenter ? 195 : 145) + tensionBoost);
        strokeWeight(isCenter ? 1.85 : 1.45);
        beginShape();
        vertex(apexX, apexY);
        for (const rn of spoke.nodes) {
          vertex(rn.x, rn.y);
        }
        // Extend side spokes cleanly toward the top/side screen edges beyond outer scalloped arch
        if (!isCenter) {
          const last = spoke.nodes[outerRingIndex];
          const prev = spoke.nodes[outerRingIndex - 1];
          const ex = last.x + (last.x - prev.x) * 1.35;
          const ey = last.y + (last.y - prev.y) * 1.35;
          vertex(ex, ey);
        }
        endShape();
      }

      // 2. Draw 4 Concentric Rings of Inward-Curving Scalloped Silk Arches
      noFill();
      for (let r = 0; r < config.numRings; r++) {
        const isOuterEdge = r === outerRingIndex;
        const alpha = (isOuterEdge ? 205 : lerp(125, 175, r / outerRingIndex)) + tensionBoost;
        stroke(248, 250, 252, alpha);
        strokeWeight(isOuterEdge ? 1.8 : 1.35);

        for (let s = 0; s < spokes.length - 1; s++) {
          const p1 = spokes[s].nodes[r];
          const p2 = spokes[s + 1].nodes[r];

          // Inward catenary scallop curving gracefully toward the top-center apex
          const midX = (p1.x + p2.x) * 0.5;
          const midY = (p1.y + p2.y) * 0.5;
          const sagPull = isOuterEdge ? 0.17 : 0.14;
          const ctrlX = lerp(midX, apexX, sagPull);
          const ctrlY = lerp(midY, apexY, sagPull);

          beginShape();
          vertex(p1.x, p1.y);
          quadraticVertex(ctrlX, ctrlY, p2.x, p2.y);
          endShape();
        }

        // Outer side scalloped wings extending left of spoke 0 and right of last spoke
        const leftMost = spokes[0].nodes[r];
        const leftNext = spokes[1].nodes[r];
        const leftWingX = leftMost.x - (leftNext.x - leftMost.x) * 1.15;
        const leftWingY = leftMost.y - (leftNext.y - leftMost.y) * 1.05;
        beginShape();
        vertex(leftWingX, leftWingY);
        quadraticVertex(
          lerp((leftWingX + leftMost.x) * 0.5, apexX, 0.14),
          lerp((leftWingY + leftMost.y) * 0.5, apexY, 0.14),
          leftMost.x,
          leftMost.y
        );
        endShape();

        const rightMost = spokes[spokes.length - 1].nodes[r];
        const rightPrev = spokes[spokes.length - 2].nodes[r];
        const rightWingX = rightMost.x + (rightMost.x - rightPrev.x) * 1.15;
        const rightWingY = rightMost.y + (rightMost.y - rightPrev.y) * 1.05;
        beginShape();
        vertex(rightMost.x, rightMost.y);
        quadraticVertex(
          lerp((rightMost.x + rightWingX) * 0.5, apexX, 0.14),
          lerp((rightMost.y + rightWingY) * 0.5, apexY, 0.14),
          rightWingX,
          rightWingY
        );
        endShape();
      }

      // 3. Subtle Silk Knot at the Center Spoke Bottom Tip (String Attachment Point)
      const centerTip = getCenterSpokeTipNode();
      noStroke();
      fill(248, 250, 252, 230);
      circle(centerTip.x, centerTip.y, 4.5);
    }

    function drawSingleHangingString() {
      const n = stringNodes.length;
      if (n < 2) return;

      const tension = spideyState.tension;

      // Subtle luminous glow when stretched
      if (tension > 0.03) {
        noFill();
        stroke(226, 232, 240, 26 + tension * 85);
        strokeWeight(5.5 + tension * 3);
        beginShape();
        curveVertex(stringNodes[0].x, stringNodes[0].y);
        for (let i = 0; i < n; i++) curveVertex(stringNodes[i].x, stringNodes[i].y);
        curveVertex(stringNodes[n - 1].x, stringNodes[n - 1].y);
        endShape();
      }

      // Clean single elastic silk strand dropping straight from the center spoke's bottom tip
      noFill();
      stroke(248, 250, 252, 235);
      strokeWeight(lerp(2.1, 1.45, tension));
      beginShape();
      curveVertex(stringNodes[0].x, stringNodes[0].y);
      for (let i = 0; i < n; i++) {
        curveVertex(stringNodes[i].x, stringNodes[i].y);
      }
      curveVertex(stringNodes[n - 1].x, stringNodes[n - 1].y);
      endShape();
    }

    // =========================================================================
    // 7. Cartoony Chibi Upside-Down Spider-Man (Curled Pose + Big Forehead)
    // =========================================================================
    function drawChibiSpiderMan() {
      const tip = stringNodes[stringNodes.length - 1];
      if (!tip) return;

      const s = constrain(Math.min(width, height) / 640, 0.85, 1.3);

      push();
      // Anchor right where his curled hands & feet clasp the bottom of the single web string
      translate(tip.x, tip.y - 4 * s);
      rotate(spideyState.angle);
      scale(s);

      // Vibrant Cartoony Palette
      const cCrimson = color('#dc2626');
      const cCrimsonBright = color('#ef4444');
      const cCrimsonShade = color('#991b1b');
      const cNavyBlue = color('#1e3a8a');
      const cBlueBright = color('#1d4ed8');
      const cOutline = color('#1e1014');
      const cWebLine = color(20, 12, 16, 165);

      strokeJoin(ROUND);
      strokeCap(ROUND);

      // -----------------------------------------------------------------------
      // A. CURLED TUCKED TORSO & ARCHED BACK
      // -----------------------------------------------------------------------
      stroke(cOutline);
      strokeWeight(2.5);
      fill(cCrimson);
      beginShape();
      vertex(-8, 10);
      bezierVertex(-27, 14, -33, 38, -21, 56);
      bezierVertex(-13, 66, -2, 66, 8, 56);
      bezierVertex(12, 42, 8, 22, -8, 10);
      endShape(CLOSE);

      // Dark Navy Blue side panel along curled hip/flank
      fill(cNavyBlue);
      beginShape();
      vertex(-14, 14);
      bezierVertex(-27, 20, -30, 36, -23, 47);
      bezierVertex(-17, 44, -14, 34, -12, 22);
      endShape(CLOSE);

      // Crisp white rim highlight along his arched back
      noStroke();
      fill(255, 255, 255, 205);
      beginShape();
      vertex(-21, 20);
      bezierVertex(-28, 30, -28, 44, -20, 54);
      bezierVertex(-24, 43, -24, 31, -19, 21);
      endShape(CLOSE);

      // Web pattern lines across his chest
      stroke(cWebLine);
      strokeWeight(1.0);
      noFill();
      bezier(-16, 46, -9, 49, -2, 48, 5, 43);
      bezier(-19, 52, -11, 56, -2, 55, 6, 50);
      line(-11, 41, -7, 60);
      line(-4, 42, -1, 61);

      // Small black spider emblem on chest
      fill(cOutline);
      noStroke();
      ellipse(-3, 52, 4.4, 5.4);
      circle(-3, 55.6, 2.9);
      stroke(cOutline);
      strokeWeight(1.15);
      noFill();
      beginShape(); vertex(-4.5, 53); vertex(-7.5, 50); vertex(-8.5, 47); endShape();
      beginShape(); vertex(-1.5, 53); vertex(1.5, 50); vertex(2.5, 47); endShape();
      beginShape(); vertex(-4.8, 54.5); vertex(-8.2, 54); vertex(-9.2, 51.5); endShape();
      beginShape(); vertex(-1.2, 54.5); vertex(2.2, 54); vertex(3.2, 51.5); endShape();
      beginShape(); vertex(-4.5, 56); vertex(-7.8, 57.5); vertex(-8.2, 60.5); endShape();
      beginShape(); vertex(-1.5, 56); vertex(1.8, 57.5); vertex(2.2, 60.5); endShape();

      // -----------------------------------------------------------------------
      // B. BENT BLUE/RED LEGS TUCKED UPWARD AROUND THE WEB STRING
      // -----------------------------------------------------------------------
      stroke(cOutline);
      strokeWeight(2.4);
      fill(cNavyBlue);
      beginShape();
      vertex(-4, 8);
      bezierVertex(-14, 2, -21, 9, -18, 21);
      bezierVertex(-15, 29, -6, 30, 0, 23);
      endShape(CLOSE);

      // Far Crimson Boot tucked at top
      fill(cCrimsonShade);
      beginShape();
      vertex(-14, 6);
      bezierVertex(-15, -3, -5, -5, -1, 4);
      bezierVertex(-3, 10, -10, 11, -14, 6);
      endShape(CLOSE);

      // Near Blue Thigh & Knee bent forward
      fill(cBlueBright);
      beginShape();
      vertex(2, 16);
      bezierVertex(14, 12, 23, 19, 20, 30);
      bezierVertex(17, 38, 6, 38, -2, 31);
      bezierVertex(-5, 25, -3, 18, 2, 16);
      endShape(CLOSE);

      // Near Crimson Boot curled right beside the web string
      fill(cCrimsonBright);
      beginShape();
      vertex(-2, 17);
      bezierVertex(-6, 6, 1, -2, 9, 2);
      bezierVertex(15, 6, 13, 16, 7, 21);
      bezierVertex(3, 23, 0, 21, -2, 17);
      endShape(CLOSE);

      stroke(cWebLine);
      strokeWeight(0.95);
      line(3, 2, 3, 20);
      arc(4, 9, 11, 6, 0.1, PI - 0.1);
      arc(4, 15, 10, 5, 0.1, PI - 0.1);

      // -----------------------------------------------------------------------
      // C. ARMS & GLOVED HANDS GRIPPING THE SINGLE VERTICAL WEB STRING
      // -----------------------------------------------------------------------
      stroke(cOutline);
      strokeWeight(2.4);
      fill(cBlueBright);
      beginShape();
      vertex(-8, 43);
      bezierVertex(-13, 35, -9, 24, -1, 21);
      vertex(6, 25);
      bezierVertex(3, 35, 1, 43, -4, 47);
      endShape(CLOSE);

      // Upper Crimson Gloved Hand gripping the string
      fill(cCrimsonBright);
      beginShape();
      vertex(-3, 18);
      bezierVertex(4, 16, 9, 21, 7, 28);
      bezierVertex(4, 32, -3, 31, -5, 26);
      endShape(CLOSE);

      // Lower Crimson Gloved Hand wrapped around the string just below
      fill(cCrimson);
      beginShape();
      vertex(-6, 25);
      bezierVertex(1, 24, 6, 29, 4, 35);
      bezierVertex(1, 38, -6, 37, -8, 32);
      endShape(CLOSE);

      stroke(cWebLine);
      strokeWeight(0.95);
      line(-4, 22, 6, 23);
      line(-6, 30, 4, 31);

      // -----------------------------------------------------------------------
      // D. OVERSIZED CHIBI HEAD WITH EXAGGERATED BIG ROUNDED FOREHEAD DOME
      // -----------------------------------------------------------------------
      push();
      translate(1, 60 + spideyState.headBob);
      rotate(spideyState.headTilt);

      // Subtle squash-and-stretch during drop/bounce jiggle
      const squash = constrain(spideyState.headBob * 0.008, -0.05, 0.06);
      scale(1 + squash, 1 - squash);

      // Big Bulbous Chibi Head (Narrow Chin at Neck, Exaggerated Large Forehead Dome Below)
      stroke(cOutline);
      strokeWeight(2.8);
      fill(cCrimsonBright);
      beginShape();
      vertex(0, -2);
      bezierVertex(-18, -1, -35, 15, -36, 37);   // Wide cheeks
      bezierVertex(-37, 62, -20, 77, 2, 77);     // Exaggerated big rounded forehead dome
      bezierVertex(24, 77, 39, 61, 38, 36);      // Right forehead dome
      bezierVertex(37, 15, 19, -1, 0, -2);
      endShape(CLOSE);

      // Deep Crimson Cel-Shading on Right Side
      noStroke();
      fill(cCrimsonShade);
      beginShape();
      vertex(2, 75.5);
      bezierVertex(23, 75.5, 37.5, 60, 36.5, 36);
      bezierVertex(35.5, 16, 19, 0.5, 1, -0.5);
      bezierVertex(14, 3, 25, 17, 26, 36);
      bezierVertex(27, 55, 17, 70, 2, 75.5);
      endShape(CLOSE);

      // Crisp White Rim Highlight along Left Cheek & Big Forehead Dome
      fill(255, 255, 255, 230);
      beginShape();
      vertex(-28, 17);
      bezierVertex(-35, 30, -35, 50, -22, 64);
      bezierVertex(-28, 50, -28, 31, -24, 19);
      endShape(CLOSE);

      // Curved Black Webbing Lines Radiating from Nose Bridge Across the Big Forehead
      const bridgeX = 4;
      const bridgeY = 23;
      stroke(cWebLine);
      strokeWeight(1.15);
      noFill();

      // Radial spokes fanning out across the forehead & cheeks
      line(bridgeX, bridgeY, 1, -1);
      bezier(bridgeX, bridgeY, -5, 12, -12, 6, -19, 4);
      bezier(bridgeX, bridgeY, 12, 12, 19, 6, 23, 4);
      bezier(bridgeX, bridgeY, -11, 25, -23, 27, -35, 31);
      bezier(bridgeX, bridgeY, 17, 25, 27, 27, 37, 30);
      // Fanning spokes down across the big rounded forehead dome
      bezier(bridgeX, bridgeY, -8, 39, -17, 55, -24, 67);
      bezier(bridgeX, bridgeY, 2, 42, 1, 59, 1, 76);
      bezier(bridgeX, bridgeY, 12, 40, 20, 55, 26, 65);

      // Concentric scalloped web rings spanning the exaggerated forehead
      arc(bridgeX, bridgeY, 24, 22, 0.15, PI - 0.15);
      arc(bridgeX, bridgeY, 45, 44, 0.18, PI - 0.12);
      arc(bridgeX, bridgeY, 66, 66, 0.22, PI - 0.08);
      arc(bridgeX, bridgeY, 86, 88, 0.28, PI - 0.05);
      // Upper chin web rings
      arc(bridgeX, bridgeY, 26, 24, PI + 0.25, TWO_PI - 0.25);
      arc(bridgeX, bridgeY, 44, 42, PI + 0.35, TWO_PI - 0.35);

      // ---------------------------------------------------------------------
      // E. LARGE EXPRESSIVE WHITE MASK LENSES WITH THICK BLACK RIMS
      //    (Positioned high near cheeks to accentuate the big forehead dome)
      // ---------------------------------------------------------------------
      const cursorDist = Math.hypot(config.pointerX - tip.x, config.pointerY - (tip.y + 88));
      const proximitySquint = config.pointerActive ? map(cursorDist, 30, 210, 0.48, 0, true) : 0;
      const expressionFactor = constrain(
        spideyState.tension * 0.45 + spideyState.speed * 0.02 + proximitySquint,
        0,
        1
      );
      const squint = lerp(0, 3.4, expressionFactor);

      // Left Eye
      push();
      translate(-15, 20);
      rotate(-0.34);
      fill(cOutline);
      noStroke();
      beginShape();
      vertex(-14.5, -7 + squint * 0.5);
      bezierVertex(-6, -15.5 + squint, 8.5, -11.5 + squint, 13.5, 3);
      bezierVertex(7, 13.5 - squint * 0.4, -8.5, 11.5 - squint * 0.4, -14.5, -7 + squint * 0.5);
      endShape(CLOSE);

      fill('#ffffff');
      beginShape();
      vertex(-10.4, -4.5 + squint * 0.55);
      bezierVertex(-4.2, -10.6 + squint * 0.9, 6.0, -7.6 + squint * 0.85, 9.7, 2.2);
      bezierVertex(4.8, 9.3 - squint * 0.4, -5.6, 7.9 - squint * 0.4, -10.4, -4.5 + squint * 0.55);
      endShape(CLOSE);
      pop();

      // Right Eye
      push();
      translate(20, 19.5);
      rotate(0.36);
      fill(cOutline);
      noStroke();
      beginShape();
      vertex(12.5, -6.5 + squint * 0.5);
      bezierVertex(5, -14.5 + squint, -7.5, -11 + squint, -12, 3);
      bezierVertex(-6, 13 - squint * 0.4, 7.5, 11 - squint * 0.4, 12.5, -6.5 + squint * 0.5);
      endShape(CLOSE);

      fill('#ffffff');
      beginShape();
      vertex(8.8, -4.2 + squint * 0.55);
      bezierVertex(3.5, -9.9 + squint * 0.9, -5.2, -7.1 + squint * 0.85, -8.5, 2.1);
      bezierVertex(-4.2, 8.9 - squint * 0.4, 5.0, 7.5 - squint * 0.4, 8.8, -4.2 + squint * 0.55);
      endShape(CLOSE);
      pop();

      pop(); // End Oversized Chibi Head
      pop(); // End Spider-Man
    }

    // =========================================================================
    // 8. Subtle Radial Cursor Field Ring
    // =========================================================================
    function drawCursorPullRing() {
      if (!config.pointerActive) {
        document.body.style.cursor = 'default';
        return;
      }

      const isActiveZone = spideyState.nearSpidey || spideyState.nearCobweb;

      document.body.style.cursor = config.isDraggingSpider
        ? 'grabbing'
        : spideyState.nearSpidey
        ? 'grab'
        : 'default';

      if (isActiveZone || config.isDraggingSpider) {
        noFill();
        stroke(spideyState.nearSpidey || config.isDraggingSpider ? 'rgba(239, 68, 68, 0.42)' : 'rgba(248, 250, 252, 0.24)');
        strokeWeight(1.15);
        const pulseR = 28 + Math.sin(millis() * 0.006) * 3.5 + config.pointerSpeed * 0.35;
        circle(config.pointerX, config.pointerY, pulseR);
      }
    }

    // =========================================================================
    // 9. Pointer, Drag-Fling & Window Resize Events
    // =========================================================================
    function updatePointerPosition(x, y) {
      if (!config.pointerActive) {
        config.prevPointerX = x;
        config.prevPointerY = y;
      }
      config.pointerX = x;
      config.pointerY = y;
      config.pointerActive = true;
    }

    // Translate viewport pointer coordinates into canvas-local coordinates.
    // This is what keeps hover, dragging and flinging correct now that the
    // canvas is a hero-sized stage rather than a fixed full-viewport layer.
    function toCanvasPoint(clientX, clientY) {
      if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
        return { x: clientX, y: clientY };
      }
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function handleMouseMove(e) {
      if (!canvas || Date.now() - config.lastTouchAt < 500) return;
      const p = toCanvasPoint(e.clientX, e.clientY);
      updatePointerPosition(p.x, p.y);
    }

    function handleMouseDown(e) {
      if (!canvas || Date.now() - config.lastTouchAt < 500) return;
      const p = toCanvasPoint(e.clientX, e.clientY);
      updatePointerPosition(p.x, p.y);
      tryGrabSpiderMan(p.x, p.y);
    }

    function tryGrabSpiderMan(x, y) {
      const tip = stringNodes[stringNodes.length - 1];
      if (!tip) return;

      const bodyCenterX = tip.x - Math.sin(spideyState.angle) * 62;
      const bodyCenterY = tip.y + Math.cos(spideyState.angle) * 62;
      const dist = Math.hypot(x - bodyCenterX, y - bodyCenterY);

      if (dist < 92) {
        config.isDraggingSpider = true;
        config.dragOffsetX = tip.x - x;
        config.dragOffsetY = tip.y - y;

        // Prevent a drag from selecting the hero copy as the pointer moves.
        document.body.classList.add('is-grabbing');
        const selection = window.getSelection && window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function releaseSpiderMan() {
      if (config.isDraggingSpider) {
        config.isDraggingSpider = false;
        document.body.classList.remove('is-grabbing');
        const tip = stringNodes[stringNodes.length - 1];
        if (tip) {
          const throwVx = (config.pointerX - config.prevPointerX) * 0.65;
          const throwVy = (config.pointerY - config.prevPointerY) * 0.65;
          tip.oldX = tip.x - constrain(throwVx, -28, 28);
          tip.oldY = tip.y - constrain(throwVy, -28, 28);
        }
      }
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    window.addEventListener('mousedown', handleMouseDown);

    window.addEventListener('mouseup', () => {
      releaseSpiderMan();
    });

    window.addEventListener('mouseleave', () => {
      releaseSpiderMan();
      config.pointerActive = false;
    });

    // Touch is handled on the stage itself so page scrolling over the hero is
    // never blocked. A touch only becomes a drag when it lands on Spider-Man.
    const stageElement = document.getElementById('canvas-container');

    if (stageElement) {
      stageElement.addEventListener('touchstart', (e) => {
        if (!canvas || e.touches.length === 0) return;
        config.lastTouchAt = Date.now();
        const t = e.touches[0];
        const p = toCanvasPoint(t.clientX, t.clientY);
        updatePointerPosition(p.x, p.y);
        tryGrabSpiderMan(p.x, p.y);
        if (config.isDraggingSpider) e.preventDefault();
      }, { passive: false });

      stageElement.addEventListener('touchmove', (e) => {
        if (!canvas || e.touches.length === 0) return;
        config.lastTouchAt = Date.now();
        if (!config.isDraggingSpider) return;
        e.preventDefault();
        const t = e.touches[0];
        const p = toCanvasPoint(t.clientX, t.clientY);
        updatePointerPosition(p.x, p.y);
      }, { passive: false });

      const endTouch = () => {
        if (config.isDraggingSpider) {
          config.lastTouchAt = Date.now();
          releaseSpiderMan();
        }
        config.pointerActive = false;
      };

      stageElement.addEventListener('touchend', endTouch);
      stageElement.addEventListener('touchcancel', endTouch);
    }

    let lastStackedLayout = null;

    function windowResized() {
      const container = document.getElementById('canvas-container');
      if (!container || !canvas) return;

      const w = Math.max(320, Math.floor(container.clientWidth));
      const h = Math.max(320, Math.floor(container.clientHeight));
      resizeCanvas(w, h);

      const stacked = isStackedLayout();
      config.apexRatio = stacked ? 0.5 : 0.72;

      // Re-seed the web when the hero switches between side-by-side and stacked
      // layouts; a plain resize keeps the current swing undisturbed.
      if (lastStackedLayout !== null && lastStackedLayout !== stacked) {
        initSimulation(true);
      } else {
        buildTopCenterCobweb();
        const targetStringLen = constrain(height * 0.26, 150, 250);
        segmentLength = targetStringLen / (config.numStringNodes - 1);
      }
      lastStackedLayout = stacked;
    }
