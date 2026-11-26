// =========================================================================
// 1. AUDIO (preloaded asset pools + looping background music)
// =========================================================================

// Each effect uses a small pool of HTMLAudioElements. Reusing voices instead
// of creating a new element per event keeps rapid hits from piling up, and a
// per-effect cooldown stops one gameplay event from firing twice.
class AudioManager {
  constructor() {
    this.basePath = 'assets/audio/game/';
    this.sfxEnabled = true;
    this.musicEnabled = true;
    this.unlocked = false;
    this.musicWanted = false;
    this.lastPlayed = {};

    this.sfxDefs = {
      shoot: { file: 'shoot.wav', volume: 0.45, voices: 3, cooldown: 55 },
      enemyHit: { file: 'enemy_hit.wav', volume: 0.4, voices: 3, cooldown: 55 },
      enemyDestroy: { file: 'enemy_destroy.wav', volume: 0.5, voices: 3, cooldown: 70 },
      playerHit: { file: 'player_hit.wav', volume: 0.6, voices: 1, cooldown: 300 },
      gameOver: { file: 'game_over.wav', volume: 0.6, voices: 1, cooldown: 3000 },
      waveStart: { file: 'wave_start.wav', volume: 0.45, voices: 1, cooldown: 900 },
      uiClick: { file: 'button_click.wav', volume: 0.3, voices: 2, cooldown: 60 }
    };

    this.ctx = null;
    this.sfxGain = null;
    this.buffers = {};
    this.buffersLoading = false;
    this.voices = {};
    this.buildSfxPools();

    this.music = new Audio(this.basePath + 'background.mp3');
    this.music.loop = true;
    this.music.preload = 'auto';
    this.music.volume = 0.25;
  }

  initWebAudio() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      this.ctx = new AudioCtx();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxEnabled ? 1 : 0;
      this.sfxGain.connect(this.ctx.destination);
      this.preloadBuffers();
    } catch {
      this.ctx = null;
      this.sfxGain = null;
    }
  }

  preloadBuffers() {
    if (!this.ctx || this.buffersLoading) return;
    this.buffersLoading = true;
    Object.entries(this.sfxDefs).forEach(([key, def]) => {
      fetch(this.basePath + def.file)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('HTTP ' + res.status))))
        .then((buf) => this.ctx.decodeAudioData(buf))
        .then((decoded) => {
          this.buffers[key] = decoded;
        })
        .catch(() => {
          // Fallback to HTMLAudioElement pool if fetch/decode is unavailable.
        });
    });
  }

  buildSfxPools() {
    Object.entries(this.sfxDefs).forEach(([key, def]) => {
      this.voices[key] = Array.from({ length: def.voices }, () => {
        const slot = { audio: null, failed: false };
        try {
          slot.audio = new Audio(this.basePath + def.file);
          slot.audio.preload = 'auto';
          slot.audio.volume = def.volume;
          // A missing or unreadable file only disables that one effect.
          slot.audio.addEventListener('error', () => {
            slot.failed = true;
          });
        } catch {
          slot.failed = true;
        }
        return slot;
      });
    });
  }

  // Called from a genuine user gesture (Start, Restart, touch, UI click).
  init() {
    this.unlocked = true;
    if (!this.ctx) {
      this.initWebAudio();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.musicWanted && this.musicEnabled && this.music.paused) {
      this.playMusic();
    }
  }

  setSfxEnabled(on) {
    this.sfxEnabled = Boolean(on);
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxEnabled ? 1 : 0, this.ctx.currentTime);
    }
    if (!this.sfxEnabled) {
      Object.values(this.voices).forEach((pool) => {
        pool.forEach((slot) => {
          if (slot.audio) slot.audio.pause();
        });
      });
    }
  }

  setMusicEnabled(on) {
    this.musicEnabled = Boolean(on);
    if (!this.musicEnabled) {
      this.music.pause();
    } else {
      this.playMusic();
    }
  }

  playSfx(key) {
    if (!this.sfxEnabled || !this.unlocked) return;
    const def = this.sfxDefs[key];
    if (!def) return;

    const now = performance.now();
    if (now - (this.lastPlayed[key] || -Infinity) < def.cooldown) return;

    if (this.ctx && this.ctx.state === 'running' && this.buffers[key] && this.sfxGain) {
      this.lastPlayed[key] = now;
      try {
        const source = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        source.buffer = this.buffers[key];
        gain.gain.value = def.volume;
        source.connect(gain);
        gain.connect(this.sfxGain);
        source.start(0);
        return;
      } catch {
        // Fall through to HTMLAudioElement pool.
      }
    }

    const pool = this.voices[key];
    if (!pool) return;
    const slot = pool.find(
      (voice) =>
        !voice.failed &&
        voice.audio &&
        (voice.audio.paused || voice.audio.ended || voice.audio.currentTime === 0)
    );
    if (!slot) return;

    this.lastPlayed[key] = now;
    try {
      slot.audio.currentTime = 0;
      slot.audio.volume = def.volume;
      const promise = slot.audio.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      // Autoplay refusal or decoding failure: gameplay continues silently.
    }
  }

  shoot() {
    this.playSfx('shoot');
  }

  enemyHit() {
    this.playSfx('enemyHit');
  }

  enemyDestroy() {
    this.playSfx('enemyDestroy');
  }

  playerHit() {
    this.playSfx('playerHit');
  }

  gameOver() {
    this.playSfx('gameOver');
  }

  waveStart() {
    this.playSfx('waveStart');
  }

  uiClick() {
    this.playSfx('uiClick');
  }

  playMusic() {
    if (!this.musicEnabled || !this.musicWanted || !this.unlocked) return;
    try {
      const promise = this.music.play();
      if (promise && typeof promise.then === 'function') {
        promise
          .then(() => {
            if (!this.musicWanted || !this.musicEnabled) {
              this.music.pause();
              try {
                this.music.currentTime = 0;
              } catch {
              }
            }
          })
          .catch(() => {});
      }
    } catch {
      // Missing music file or autoplay refusal: play without music.
    }
  }

  startMusic() {
    this.musicWanted = true;
    this.playMusic();
  }

  resumeMusic() {
    this.musicWanted = true;
    this.playMusic();
  }

  pauseMusic() {
    this.music.pause();
  }

  stopMusic() {
    this.musicWanted = false;
    this.music.pause();
    try {
      this.music.currentTime = 0;
    } catch {
    }
  }
}

// =========================================================================
// 2. PURE GAME SIMULATION & MECHANICS
// =========================================================================
class GameEngine {
  constructor(sfx, reducedMotion = false) {
    this.sfx = sfx;
    this.reducedMotion = reducedMotion;
    this.storageKey = 'portfolio_aegis_highscore_v1';

    this.width = 960;
    this.height = 500;
    this.state = 'START';

    this.score = 0;
    this.highScore = this.loadHighScore();
    this.wave = 1;
    this.waveBannerTimer = 0;

    this.player = null;
    this.bullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.boss = null;
    this.powerups = [];
    this.particles = [];
    this.ambientMotes = [];

    this.input = { left: false, right: false, fire: false };
    this.spawnQueue = [];
    this.spawnTimer = 0;

    this.initAmbientMotes();
    this.resetPlayer();
  }

  loadHighScore() {
    try {
      return parseInt(localStorage.getItem(this.storageKey) || '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  saveHighScore(val) {
    if (val > this.highScore) {
      this.highScore = val;
      try {
        localStorage.setItem(this.storageKey, String(this.highScore));
      } catch {
      }
    }
  }

  resize(width, height) {
    const prevW = this.width || width;
    this.width = Math.max(300, width);
    this.height = Math.max(320, height);

    if (this.player) {
      this.player.x = Math.min(
        this.width - this.player.radius - 10,
        Math.max(this.player.radius + 10, (this.player.x / prevW) * this.width)
      );
      this.player.y = this.height - 44;
    }
    if (this.boss) {
      this.boss.x = Math.min(this.width - 70, Math.max(70, this.boss.x));
    }
  }

  initAmbientMotes() {
    const count = this.reducedMotion ? 10 : 22;
    this.ambientMotes = Array.from({ length: count }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      size: Math.random() * 1.3 + 0.5,
      speed: Math.random() * 14 + 6,
      alpha: Math.random() * 0.25 + 0.08
    }));
  }

  resetPlayer() {
    this.player = {
      x: this.width / 2,
      y: this.height - 44,
      radius: 15,
      speed: 370,
      lives: 3,
      maxLives: 4,
      invulnTimer: 0,
      fireCooldown: 0,
      rapidTimer: 0,
      multiTimer: 0,
      shield: false,
      tilt: 0
    };
  }

  startNewGame() {
    this.sfx.init();
    this.score = 0;
    this.wave = 1;
    this.bullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.boss = null;
    this.powerups = [];
    this.particles = [];
    this.resetPlayer();
    this.state = 'PLAYING';
    this.setupWave(this.wave);
  }

  setupWave(waveNum) {
    this.sfx.waveStart();
    this.waveBannerTimer = 1.6;
    this.spawnQueue = [];
    this.spawnTimer = 0.4;

    if (waveNum % 4 === 0) {
      const bossHp = 28 + waveNum * 6;
      this.boss = {
        x: this.width / 2,
        y: -55,
        targetY: 78,
        width: 112,
        height: 44,
        hp: bossHp,
        maxHp: bossHp,
        dir: 1,
        speed: 85 + Math.min(50, waveNum * 4),
        fireTimer: 1.4,
        patternIndex: 0,
        hitFlash: 0
      };
      return;
    }

    const totalEnemies = Math.min(22, 6 + waveNum * 2);
    for (let i = 0; i < totalEnemies; i++) {
      let type = 'scout';
      if (waveNum >= 2 && i % 4 === 2) type = 'interceptor';
      if (waveNum >= 3 && i % 6 === 4) type = 'cruiser';
      this.spawnQueue.push(type);
    }
  }

  spawnEnemy(type) {
    const margin = 44;
    const x = margin + Math.random() * (this.width - margin * 2);
    const speedScale = 1 + Math.min(0.65, (this.wave - 1) * 0.06);

    if (type === 'scout') {
      this.enemies.push({
        type: 'scout',
        x,
        baseX: x,
        y: -24,
        radius: 13,
        hp: 1,
        maxHp: 1,
        vy: 76 * speedScale,
        phase: Math.random() * Math.PI * 2,
        amp: 28 + Math.random() * 18,
        fireTimer: 1.4 + Math.random() * 1.8,
        points: 100,
        hitFlash: 0
      });
    } else if (type === 'interceptor') {
      this.enemies.push({
        type: 'interceptor',
        x,
        y: -26,
        radius: 14,
        hp: 2,
        maxHp: 2,
        vy: 112 * speedScale,
        vx: 0,
        dashTimer: 0.9 + Math.random() * 0.8,
        fireTimer: 1.1 + Math.random() * 1.2,
        points: 180,
        hitFlash: 0
      });
    } else {
      this.enemies.push({
        type: 'cruiser',
        x,
        y: -30,
        radius: 19,
        hp: 4 + Math.floor(this.wave / 3),
        maxHp: 4 + Math.floor(this.wave / 3),
        vy: 46 * speedScale,
        fireTimer: 1.5 + Math.random() * 1.0,
        points: 320,
        hitFlash: 0
      });
    }
  }

  update(dt) {
    for (const m of this.ambientMotes) {
      m.y += m.speed * dt * (this.state === 'PLAYING' ? 1.5 : 0.6);
      if (m.y > this.height) {
        m.y = -4;
        m.x = Math.random() * this.width;
      }
    }

    if (this.state !== 'PLAYING') return;

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);
    }

    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updatePowerups(dt);
    this.updateParticles(dt);

    if (
      this.spawnQueue.length === 0 &&
      this.enemies.length === 0 &&
      !this.boss
    ) {
      this.wave += 1;
      this.setupWave(this.wave);
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    if (p.rapidTimer > 0) p.rapidTimer = Math.max(0, p.rapidTimer - dt);
    if (p.multiTimer > 0) p.multiTimer = Math.max(0, p.multiTimer - dt);

    const moveDir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    p.x += moveDir * p.speed * dt;
    p.x = Math.max(p.radius + 12, Math.min(this.width - p.radius - 12, p.x));

    const targetTilt = moveDir * 0.22;
    p.tilt += (targetTilt - p.tilt) * Math.min(1, dt * 14);

    if (!this.reducedMotion && Math.random() < 0.55) {
      this.particles.push({
        x: p.x + (Math.random() - 0.5) * 6,
        y: p.y + 14,
        vx: (Math.random() - 0.5) * 14,
        vy: 55 + Math.random() * 35,
        life: 0.22,
        maxLife: 0.22,
        size: 1.6,
        color: p.rapidTimer > 0 ? '#a78bfa' : '#94a3b8'
      });
    }

    if (this.input.fire && p.fireCooldown <= 0) {
      this.firePlayerWeapon();
    }
  }

  firePlayerWeapon() {
    const p = this.player;
    p.fireCooldown = p.rapidTimer > 0 ? 0.12 : 0.23;
    this.sfx.shoot();

    const speed = -540;
    if (p.multiTimer > 0) {
      this.bullets.push(
        { x: p.x, y: p.y - 16, vx: 0, vy: speed },
        { x: p.x - 10, y: p.y - 10, vx: -58, vy: speed * 0.98 },
        { x: p.x + 10, y: p.y - 10, vx: 58, vy: speed * 0.98 }
      );
    } else {
      this.bullets.push({ x: p.x, y: p.y - 16, vx: 0, vy: speed });
    }
  }

  updateSpawning(dt) {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const nextType = this.spawnQueue.shift();
      this.spawnEnemy(nextType);
      this.spawnTimer = Math.max(0.32, 0.78 - this.wave * 0.03);
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > this.width + 20) {
        this.bullets.splice(i, 1);
      }
    }

    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const eb = this.enemyBullets[i];
      eb.x += eb.vx * dt;
      eb.y += eb.vy * dt;
      if (eb.y > this.height + 20 || eb.x < -20 || eb.x > this.width + 20) {
        this.enemyBullets.splice(i, 1);
        continue;
      }

      const dx = eb.x - this.player.x;
      const dy = eb.y - this.player.y;
      const hitDist = this.player.radius * 0.72 + 4;
      if (dx * dx + dy * dy < hitDist * hitDist) {
        this.enemyBullets.splice(i, 1);
        this.damagePlayer();
      }
    }
  }

  updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);

      if (e.type === 'scout') {
        e.phase += dt * 2.6;
        e.y += e.vy * dt;
        e.x = Math.max(24, Math.min(this.width - 24, e.baseX + Math.sin(e.phase) * e.amp));
      } else if (e.type === 'interceptor') {
        e.dashTimer -= dt;
        if (e.dashTimer <= 0 && e.vx === 0 && e.y > 40 && e.y < this.height * 0.55) {
          const dir = Math.sign(this.player.x - e.x) || 1;
          e.vx = dir * 135;
        }
        e.x = Math.max(24, Math.min(this.width - 24, e.x + e.vx * dt));
        e.y += e.vy * dt;
      } else {
        e.y += e.vy * dt;
      }

      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.y > 24 && e.y < this.height - 135) {
        this.fireEnemyWeapon(e);
      }

      let destroyed = false;
      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const b = this.bullets[j];
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const r = e.radius + 5;
        if (dx * dx + dy * dy < r * r) {
          this.bullets.splice(j, 1);
          e.hp -= 1;
          e.hitFlash = 0.08;
          this.spawnSparks(b.x, b.y, '#f1f5f9', 4);
          if (e.hp <= 0) {
            this.destroyEnemy(i);
            destroyed = true;
          } else {
            this.sfx.enemyHit();
          }
          break;
        }
      }
      if (destroyed) continue;

      const pdx = e.x - this.player.x;
      const pdy = e.y - this.player.y;
      const crashDist = e.radius + this.player.radius * 0.78;
      if (pdx * pdx + pdy * pdy < crashDist * crashDist) {
        this.destroyEnemy(i, false);
        this.damagePlayer();
        continue;
      }

      if (e.y > this.height + 35) {
        this.enemies.splice(i, 1);
      }
    }
  }

  fireEnemyWeapon(e) {
    const bulletSpeed = 215 + Math.min(95, this.wave * 8);
    if (e.type === 'scout') {
      e.fireTimer = 2.1 + Math.random() * 1.4;
      this.enemyBullets.push({ x: e.x, y: e.y + 12, vx: 0, vy: bulletSpeed });
    } else if (e.type === 'interceptor') {
      e.fireTimer = 1.8 + Math.random() * 1.1;
      this.enemyBullets.push(
        { x: e.x - 6, y: e.y + 12, vx: -18, vy: bulletSpeed * 1.05 },
        { x: e.x + 6, y: e.y + 12, vx: 18, vy: bulletSpeed * 1.05 }
      );
    } else {
      e.fireTimer = 2.3 + Math.random() * 0.9;
      this.enemyBullets.push(
        { x: e.x, y: e.y + 16, vx: 0, vy: bulletSpeed * 0.95 },
        { x: e.x - 8, y: e.y + 14, vx: -55, vy: bulletSpeed * 0.9 },
        { x: e.x + 8, y: e.y + 14, vx: 55, vy: bulletSpeed * 0.9 }
      );
    }
  }

  destroyEnemy(index, awardPoints = true) {
    const e = this.enemies[index];
    this.enemies.splice(index, 1);
    this.sfx.enemyDestroy();
    this.spawnSparks(e.x, e.y, e.type === 'cruiser' ? '#f43f5e' : '#94a3b8', e.type === 'cruiser' ? 14 : 9);

    if (awardPoints) {
      this.addScore(e.points);
      const dropChance = e.type === 'cruiser' ? 0.34 : 0.11;
      if (Math.random() < dropChance) {
        this.spawnPowerup(e.x, e.y);
      }
    }
  }

  updateBoss(dt) {
    const b = this.boss;
    if (!b) return;

    if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - dt);

    if (b.y < b.targetY) {
      b.y += 55 * dt;
      return;
    }

    b.x += b.dir * b.speed * dt;
    if (b.x > this.width - 75) {
      b.x = this.width - 75;
      b.dir = -1;
    } else if (b.x < 75) {
      b.x = 75;
      b.dir = 1;
    }

    b.fireTimer -= dt;
    if (b.fireTimer <= 0) {
      b.patternIndex = (b.patternIndex + 1) % 2;
      const spd = 225;
      if (b.patternIndex === 0) {
        b.fireTimer = 1.35;
        [-75, -35, 35, 75].forEach((vx) => {
          this.enemyBullets.push({ x: b.x, y: b.y + 22, vx, vy: spd });
        });
      } else {
        b.fireTimer = 1.15;
        this.enemyBullets.push(
          { x: b.x - 34, y: b.y + 18, vx: 0, vy: spd * 1.12 },
          { x: b.x + 34, y: b.y + 18, vx: 0, vy: spd * 1.12 }
        );
      }
    }

    for (let j = this.bullets.length - 1; j >= 0; j--) {
      const shot = this.bullets[j];
      if (
        Math.abs(shot.x - b.x) < b.width * 0.5 &&
        Math.abs(shot.y - b.y) < b.height * 0.55
      ) {
        this.bullets.splice(j, 1);
        b.hp -= 1;
        b.hitFlash = 0.06;
        this.spawnSparks(shot.x, shot.y, '#a78bfa', 5);

        if (b.hp <= 0) {
          this.sfx.enemyDestroy();
          this.spawnSparks(b.x, b.y, '#f43f5e', 24);
          this.spawnSparks(b.x, b.y, '#a78bfa', 18);
          this.addScore(1500 + this.wave * 200);
          this.spawnPowerup(b.x, b.y);
          this.boss = null;
          break;
        } else {
          this.sfx.enemyHit();
        }
      }
    }
  }

  spawnPowerup(x, y) {
    const types = ['rapid', 'multi', 'shield'];
    const type = types[Math.floor(Math.random() * types.length)];
    this.powerups.push({ x, y, vy: 82, radius: 11, type, pulse: 0 });
  }

  updatePowerups(dt) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pw = this.powerups[i];
      pw.y += pw.vy * dt;
      pw.pulse += dt * 5;

      const dx = pw.x - this.player.x;
      const dy = pw.y - this.player.y;
      const dist = pw.radius + this.player.radius + 4;
      if (dx * dx + dy * dy < dist * dist) {
        this.applyPowerup(pw.type);
        this.powerups.splice(i, 1);
        continue;
      }

      if (pw.y > this.height + 24) {
        this.powerups.splice(i, 1);
      }
    }
  }

  applyPowerup(type) {
    this.addScore(150);
    if (type === 'rapid') this.player.rapidTimer = 7.5;
    if (type === 'multi') this.player.multiTimer = 7.5;
    if (type === 'shield') {
      if (this.player.shield && this.player.lives < this.player.maxLives) {
        this.player.lives += 1;
      } else {
        this.player.shield = true;
      }
    }
  }

  damagePlayer() {
    const p = this.player;
    if (p.invulnTimer > 0) return;

    if (p.shield) {
      p.shield = false;
      p.invulnTimer = 1.1;
      this.sfx.enemyHit();
      this.spawnSparks(p.x, p.y, '#a78bfa', 14);
      return;
    }

    p.lives -= 1;
    p.invulnTimer = 1.85;
    p.rapidTimer = 0;
    p.multiTimer = 0;
    this.spawnSparks(p.x, p.y, '#f43f5e', 18);

    if (p.lives <= 0) {
      this.state = 'GAMEOVER';
      this.saveHighScore(this.score);
      this.sfx.gameOver();
    } else {
      this.sfx.playerHit();
    }
  }

  addScore(pts) {
    this.score += pts;
    if (this.score > this.highScore) {
      this.saveHighScore(this.score);
    }
  }

  spawnSparks(x, y, color, count) {
    const actualCount = this.reducedMotion ? Math.ceil(count * 0.4) : count;
    for (let i = 0; i < actualCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 115;
      const life = 0.22 + Math.random() * 0.24;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 1.4 + Math.random() * 1.4,
        color
      });
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }
}

// =========================================================================
// 3. STATELESS TRANSPARENT CANVAS RENDERER
// =========================================================================
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
  }

  render(engine) {
    const ctx = this.ctx;
    const w = engine.width;
    const h = engine.height;

    ctx.clearRect(0, 0, w, h);

    for (const m of engine.ambientMotes) {
      ctx.fillStyle = `rgba(148, 163, 184, ${m.alpha})`;
      ctx.fillRect(m.x, m.y, m.size, m.size);
    }

    if (engine.state === 'START') return;

    if (engine.waveBannerTimer > 0 && engine.state === 'PLAYING') {
      const alpha = Math.min(1, engine.waveBannerTimer);
      ctx.save();
      ctx.font = '500 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(180, 87, 75, ${alpha * 0.85})`;
      const label = engine.wave % 4 === 0 ? `WAVE ${engine.wave} — DREADNOUGHT` : `WAVE ${String(engine.wave).padStart(2, '0')}`;
      ctx.fillText(label, w / 2, h * 0.36);
      ctx.restore();
    }

    for (const pw of engine.powerups) {
      this.drawPowerup(ctx, pw);
    }

    for (const b of engine.bullets) {
      ctx.fillStyle = engine.player.multiTimer > 0 ? '#a78bfa' : '#f1f5f9';
      ctx.fillRect(b.x - 1.25, b.y - 8, 2.5, 13);
    }

    for (const eb of engine.enemyBullets) {
      ctx.save();
      ctx.translate(eb.x, eb.y);
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.lineTo(3, 0);
      ctx.lineTo(0, -5);
      ctx.lineTo(-3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const e of engine.enemies) {
      this.drawEnemy(ctx, e);
    }

    if (engine.boss) {
      this.drawBoss(ctx, engine.boss, w);
    }

    if (engine.player && engine.player.lives > 0) {
      this.drawPlayer(ctx, engine.player);
    }

    for (const pt of engine.particles) {
      const alpha = Math.max(0, pt.life / pt.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }
  }

  drawPlayer(ctx, p) {
    if (p.invulnTimer > 0 && Math.floor(p.invulnTimer * 14) % 2 === 0) {
      return;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);

    if (p.shield) {
      ctx.strokeStyle = 'rgba(180, 87, 75, 0.55)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(0, 1, 21, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(-15, 11);
    ctx.lineTo(-6, -3);
    ctx.lineTo(-6, 12);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(15, 11);
    ctx.lineTo(6, -3);
    ctx.lineTo(6, 12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(6.5, 4);
    ctx.lineTo(4, 14);
    ctx.lineTo(-4, 14);
    ctx.lineTo(-6.5, 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(2.4, 1);
    ctx.lineTo(-2.4, 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = p.rapidTimer > 0 || p.multiTimer > 0 ? '#a78bfa' : '#cbd5e1';
    ctx.fillRect(-15, 7, 2, 5);
    ctx.fillRect(13, 7, 2, 5);

    ctx.restore();
  }

  drawEnemy(ctx, e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const flashing = e.hitFlash > 0;

    if (e.type === 'scout') {
      ctx.strokeStyle = flashing ? '#f1f5f9' : '#94a3b8';
      ctx.fillStyle = flashing ? 'rgba(241,245,249,0.28)' : 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(13, -6);
      ctx.lineTo(0, -2);
      ctx.lineTo(-13, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(-2, 1, 4, 4);
    } else if (e.type === 'interceptor') {
      ctx.strokeStyle = flashing ? '#f1f5f9' : '#cbd5e1';
      ctx.fillStyle = flashing ? 'rgba(241,245,249,0.3)' : 'rgba(244, 63, 94, 0.12)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(12, -2);
      ctx.lineTo(7, -12);
      ctx.lineTo(0, -6);
      ctx.lineTo(-7, -12);
      ctx.lineTo(-12, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = flashing ? '#f1f5f9' : '#f43f5e';
      ctx.fillStyle = flashing ? 'rgba(241,245,249,0.28)' : 'rgba(244, 63, 94, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-11, -14);
      ctx.lineTo(11, -14);
      ctx.lineTo(19, 0);
      ctx.lineTo(11, 14);
      ctx.lineTo(-11, 14);
      ctx.lineTo(-19, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-5, -5, 10, 10);
    }

    ctx.restore();
  }

  drawBoss(ctx, b, canvasWidth) {
    ctx.save();
    ctx.translate(b.x, b.y);
    const flashing = b.hitFlash > 0;

    ctx.strokeStyle = flashing ? '#f1f5f9' : '#f43f5e';
    ctx.fillStyle = flashing ? 'rgba(241, 245, 249, 0.22)' : 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = 1.6;

    ctx.beginPath();
    ctx.moveTo(-54, -10);
    ctx.lineTo(-28, -22);
    ctx.lineTo(28, -22);
    ctx.lineTo(54, -10);
    ctx.lineTo(42, 16);
    ctx.lineTo(14, 22);
    ctx.lineTo(-14, 22);
    ctx.lineTo(-42, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#b4574b';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-14, -7, 28, 14);

    ctx.restore();

    const barW = Math.min(260, canvasWidth * 0.45);
    const barX = (canvasWidth - barW) / 2;
    const barY = 36;
    const pct = Math.max(0, b.hp / b.maxHp);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillRect(barX, barY, barW, 3);
    ctx.fillStyle = '#b4574b';
    ctx.fillRect(barX, barY, barW * pct, 3);
  }

  drawPowerup(ctx, pw) {
    ctx.save();
    ctx.translate(pw.x, pw.y);
    const scale = 1 + Math.sin(pw.pulse) * 0.08;
    ctx.scale(scale, scale);

    ctx.strokeStyle = '#b4574b';
    ctx.fillStyle = 'rgba(180, 87, 75, 0.16)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(11, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = pw.type === 'rapid' ? 'R' : pw.type === 'multi' ? 'M' : 'S';
    ctx.fillText(glyph, 0, 0.5);

    ctx.restore();
  }
}

// =========================================================================
// 4. PORTFOLIO WIDGET CONTROLLER
// =========================================================================
class PortfolioGameWidget {
  constructor() {
    this.drawer = document.getElementById('portfolio-game-drawer');
    this.toggleBtn = document.getElementById('game-mode-toggle');
    this.launcher = document.querySelector('.game-launch');
    this.stage = document.getElementById('shooter-stage');
    this.canvas = document.getElementById('shooter-canvas');

    this.hudScore = document.getElementById('hud-score');
    this.hudBest = document.getElementById('hud-best');
    this.hudWave = document.getElementById('hud-wave');
    this.hudLives = document.getElementById('hud-lives');
    this.hudPowerups = document.getElementById('hud-powerups');

    this.overlayStart = document.getElementById('overlay-start');
    this.overlayPause = document.getElementById('overlay-pause');
    this.overlayGameOver = document.getElementById('overlay-gameover');

    this.finalScore = document.getElementById('final-score');
    this.finalWave = document.getElementById('final-wave');
    this.finalBest = document.getElementById('final-best');

    this.btnSfx = document.getElementById('btn-sfx');
    this.btnMusic = document.getElementById('btn-music');
    this.btnPause = document.getElementById('btn-pause');
    this.touchControls = document.getElementById('touch-controls');

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.audio = new AudioManager();
    this.engine = new GameEngine(this.audio, prefersReduced);
    this.renderer = new Renderer(this.canvas);

    this.isOpen = false;
    this.rafId = null;
    this.lastTimestamp = 0;
    this.lastHudSnapshot = '';

    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);
    this.onVisibilityChange = this.handleVisibilityChange.bind(this);
    this.onPageHide = this.handlePageHide.bind(this);
    this.onNavAway = this.handleNavAway.bind(this);
    this.loop = this.frameLoop.bind(this);
    this.drawerObserver = null;
    this.drawerSeenInView = false;

    this.bindUI();
    this.setupResizeObserver();
    this.setupDrawerObserver();
    this.syncHud(true);
    this.syncAudioButtons();
  }

  bindUI() {
    this.toggleBtn.addEventListener('click', () => {
      this.isOpen ? this.close() : this.open();
    });

    document.getElementById('btn-exit-pause').addEventListener('click', () => this.close());
    document.getElementById('btn-exit-over').addEventListener('click', () => this.close());

    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart').addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart-hud').addEventListener('click', () => this.startGame());

    document.getElementById('btn-resume').addEventListener('click', () => {
      if (this.engine.state === 'PAUSED') {
        this.audio.init();
        this.engine.state = 'PLAYING';
        this.lastTimestamp = performance.now();
        this.audio.resumeMusic();
        this.syncOverlays();
        this.focusCanvas();
      }
    });

    this.btnPause.addEventListener('click', () => this.togglePause());

    this.btnSfx.addEventListener('click', () => {
      this.audio.setSfxEnabled(!this.audio.sfxEnabled);
      this.syncAudioButtons();
    });

    this.btnMusic.addEventListener('click', () => {
      this.audio.setMusicEnabled(!this.audio.musicEnabled);
      this.syncAudioButtons();
    });

    this.bindTouchButton('touch-left', 'left');
    this.bindTouchButton('touch-right', 'right');
    this.bindTouchButton('touch-fire', 'fire');

    // Subtle click feedback for every game UI button except the touch pad,
    // whose presses are gameplay input rather than menu interaction.
    const playUiClick = (event) => {
      const btn = event.target.closest('button');
      if (!btn || btn.classList.contains('touch-btn')) return;
      this.audio.init();
      this.audio.uiClick();
    };
    this.stage.addEventListener('click', playUiClick);
    if (this.launcher) this.launcher.addEventListener('click', playUiClick);

    const navbar = document.querySelector('.navbar');
    if (navbar) {
      navbar.addEventListener('click', (event) => {
        const link = event.target.closest('a[href^="#"]');
        if (link && this.isOpen) {
          this.close();
        }
      });
    }
    window.addEventListener('hashchange', this.onNavAway);
    window.addEventListener('pagehide', this.onPageHide);
  }

  startGame() {
    this.audio.init();
    this.engine.startNewGame();
    this.audio.startMusic();
    this.syncOverlays();
    this.syncHud(true);
    this.focusCanvas();
  }

  syncAudioButtons() {
    const sfxOn = this.audio.sfxEnabled;
    const musicOn = this.audio.musicEnabled;

    this.btnSfx.textContent = sfxOn ? 'SFX: ON' : 'SFX: OFF';
    this.btnSfx.setAttribute('aria-pressed', String(sfxOn));
    this.btnSfx.title = sfxOn ? 'Mute sound effects' : 'Enable sound effects';

    this.btnMusic.textContent = musicOn ? 'MUSIC: ON' : 'MUSIC: OFF';
    this.btnMusic.setAttribute('aria-pressed', String(musicOn));
    this.btnMusic.title = musicOn ? 'Mute music' : 'Enable music';
  }

  bindTouchButton(id, controlKey) {
    const el = document.getElementById(id);
    if (!el) return;

    const press = (e) => {
      if (e.cancelable) e.preventDefault();
      this.audio.init();
      this.engine.input[controlKey] = true;
      el.classList.add('pressed');
      if (e.pointerId !== undefined && el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
        }
      }
      if (controlKey === 'fire' && this.engine.state === 'PLAYING' && this.engine.player.fireCooldown <= 0) {
        this.engine.firePlayerWeapon();
      }
    };
    const release = (e) => {
      if (e && e.cancelable) e.preventDefault();
      this.engine.input[controlKey] = false;
      el.classList.remove('pressed');
    };

    if (window.PointerEvent) {
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    } else {
      el.addEventListener('touchstart', press, { passive: false });
      el.addEventListener('touchend', release, { passive: false });
      el.addEventListener('touchcancel', release, { passive: false });
      el.addEventListener('mousedown', press);
      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', release);
    }

    el.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        press(e);
      }
    });
    el.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        release(e);
      }
    });
  }

  setupResizeObserver() {
    const updateSize = () => {
      const rect = this.stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.engine.resize(rect.width, rect.height);
      this.renderer.render(this.engine);
    };

    this.resizeObserver = new ResizeObserver(updateSize);
    this.resizeObserver.observe(this.stage);
    updateSize();
  }

  setupDrawerObserver() {
    if (!('IntersectionObserver' in window)) return;
    this.drawerObserver = new IntersectionObserver(
      (entries) => {
        if (!this.isOpen) return;
        const entry = entries[0];
        if (entry.isIntersecting) {
          this.drawerSeenInView = true;
        } else if (this.drawerSeenInView) {
          if (this.engine.state === 'PLAYING') {
            this.engine.state = 'PAUSED';
            this.syncOverlays();
          }
          this.audio.stopMusic();
        }
      },
      { threshold: 0.05 }
    );
  }

  focusCanvas() {
    if (!this.canvas) return;
    try {
      this.canvas.focus({ preventScroll: true });
    } catch {
      this.canvas.focus();
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.drawerSeenInView = false;
    document.body.classList.remove('game-closing');
    this.drawer.classList.add('is-open');
    this.drawer.setAttribute('aria-hidden', 'false');
    this.drawer.inert = false;
    this.toggleBtn.setAttribute('aria-expanded', 'true');
    this.toggleBtn.classList.add('is-active');
    this.toggleBtn.title = 'Close Web Rush';
    if (this.launcher) this.launcher.classList.add('is-active');
    document.body.classList.add('game-open');

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (this.drawerObserver) this.drawerObserver.observe(this.drawer);

    // The launcher sits below the sticky navbar, so the drawer can be
    // off-screen when it is opened from further down the page. Bring it below
    // both the navbar and the launcher so the HUD is never covered.
    const header = document.querySelector('.site-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 68;
    const launcherHeight = this.launcher
      ? this.launcher.getBoundingClientRect().height
      : 48;
    const drawerTop =
      this.drawer.getBoundingClientRect().top +
      window.scrollY -
      headerHeight -
      launcherHeight -
      8;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, drawerTop), behavior: reduced ? 'auto' : 'smooth' });

    this.syncOverlays();
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
    this.focusCanvas();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.engine.state === 'PLAYING') {
      this.engine.state = 'PAUSED';
    }

    this.engine.input.left = false;
    this.engine.input.right = false;
    this.engine.input.fire = false;
    this.audio.stopMusic();

    if (this.drawerObserver) this.drawerObserver.unobserve(this.drawer);
    this.drawerSeenInView = false;

    this.drawer.classList.remove('is-open');
    this.drawer.setAttribute('aria-hidden', 'true');
    this.drawer.inert = true;
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.toggleBtn.classList.remove('is-active');
    this.toggleBtn.title = 'Open Web Rush';
    if (this.launcher) this.launcher.classList.remove('is-active');
    document.body.classList.add('game-closing');
    document.body.classList.remove('game-open');
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      if (!this.isOpen) document.body.classList.remove('game-closing');
    }, 420);

    // Closing the game also dismisses the controls popover and hides the
    // information button that belongs to it.
    document.dispatchEvent(new CustomEvent('game-mode-closed'));

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // The launcher reappears when closed, so return keyboard focus to it.
    this.toggleBtn.focus({ preventScroll: true });
  }

  togglePause() {
    if (this.engine.state === 'PLAYING') {
      this.engine.state = 'PAUSED';
      this.audio.pauseMusic();
      this.syncOverlays();
    } else if (this.engine.state === 'PAUSED') {
      this.audio.init();
      this.engine.state = 'PLAYING';
      this.lastTimestamp = performance.now();
      this.audio.resumeMusic();
      this.syncOverlays();
    }
  }

  handleVisibilityChange() {
    if (document.hidden && this.engine.state === 'PLAYING') {
      this.engine.state = 'PAUSED';
      this.audio.pauseMusic();
      this.syncOverlays();
    }
  }

  handlePageHide() {
    if (this.engine.state === 'PLAYING') {
      this.engine.state = 'PAUSED';
      this.syncOverlays();
    }
    this.audio.stopMusic();
  }

  handleNavAway() {
    if (this.isOpen) {
      this.close();
    } else {
      this.audio.stopMusic();
    }
  }

  destroy() {
    this.close();
    this.audio.stopMusic();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.drawerObserver) this.drawerObserver.disconnect();
    window.removeEventListener('hashchange', this.onNavAway);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  handleKeyDown(e) {
    if (!this.isOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Let the launcher controls (Game Mode toggle, controls info) keep their
    // own keyboard behaviour instead of firing the game.
    if (active && active.closest && active.closest('.game-launch')) return;

    const code = e.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) {
      e.preventDefault();
    }

    if (code === 'ArrowLeft' || code === 'KeyA') this.engine.input.left = true;
    if (code === 'ArrowRight' || code === 'KeyD') this.engine.input.right = true;
    if (code === 'Space') {
      if (this.engine.state === 'START' || this.engine.state === 'GAMEOVER') {
        this.startGame();
      } else {
        this.engine.input.fire = true;
        if (this.engine.state === 'PLAYING' && this.engine.player.fireCooldown <= 0) {
          this.engine.firePlayerWeapon();
        }
      }
    }
    if (code === 'Escape') {
      if (this.engine.state === 'PLAYING' || this.engine.state === 'PAUSED') {
        this.togglePause();
      } else {
        this.close();
      }
    }
  }

  handleKeyUp(e) {
    const code = e.code;
    if (code === 'ArrowLeft' || code === 'KeyA') this.engine.input.left = false;
    if (code === 'ArrowRight' || code === 'KeyD') this.engine.input.right = false;
    if (code === 'Space') this.engine.input.fire = false;
  }

  syncOverlays() {
    const s = this.engine.state;
    this.overlayStart.classList.toggle('hidden', s !== 'START');
    this.overlayPause.classList.toggle('hidden', s !== 'PAUSED');
    this.overlayGameOver.classList.toggle('hidden', s !== 'GAMEOVER');
    this.touchControls.classList.toggle('active', s === 'PLAYING');

    if (s === 'GAMEOVER') {
      this.audio.stopMusic();
      this.finalScore.textContent = this.engine.score;
      this.finalWave.textContent = this.engine.wave;
      this.finalBest.textContent = this.engine.highScore;
    }
  }

  syncHud(force = false) {
    const e = this.engine;
    const p = e.player;
    const rapidSec = Math.ceil(p.rapidTimer);
    const multiSec = Math.ceil(p.multiTimer);
    const snapshot = `${e.score}|${e.highScore}|${e.wave}|${p.lives}|${p.shield}|${rapidSec}|${multiSec}|${e.state}`;

    if (!force && snapshot === this.lastHudSnapshot) return;
    this.lastHudSnapshot = snapshot;

    this.hudScore.textContent = String(e.score).padStart(4, '0');
    this.hudBest.textContent = String(e.highScore).padStart(4, '0');
    this.hudWave.textContent = String(e.wave).padStart(2, '0');
    this.btnPause.textContent = e.state === 'PAUSED' ? 'RESUME' : 'PAUSE';
    this.btnPause.disabled = e.state !== 'PLAYING' && e.state !== 'PAUSED';

    let livesHtml = '';
    for (let i = 0; i < p.maxLives; i++) {
      if (i >= 3 && p.lives <= 3) continue;
      const lost = i >= p.lives ? 'lost' : '';
      livesHtml += `<svg class="life-pip ${lost}" viewBox="0 0 16 16" fill="#f1f5f9"><polygon points="8,1 14,14 8,11 2,14"/></svg>`;
    }
    this.hudLives.innerHTML = livesHtml;

    const badges = [];
    if (p.shield) badges.push('<span class="powerup-badge">SHIELD</span>');
    if (rapidSec > 0) badges.push(`<span class="powerup-badge">RAPID ${rapidSec}s</span>`);
    if (multiSec > 0) badges.push(`<span class="powerup-badge">MULTI ${multiSec}s</span>`);
    this.hudPowerups.innerHTML = badges.join('');

    if (e.state === 'GAMEOVER') {
      this.syncOverlays();
    }
  }

  frameLoop(timestamp) {
    if (!this.isOpen) return;
    const dt = Math.min(0.05, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;

    this.engine.update(dt);
    this.renderer.render(this.engine);
    this.syncHud();

    this.rafId = requestAnimationFrame(this.loop);
  }
}

// =========================================================================
// 5. SCROLL MOTION
// =========================================================================
const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initFadeIn() {
  const items = Array.from(document.querySelectorAll('.fade-in'));
  if (!items.length) return;

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  );

  items.forEach((el) => observer.observe(el));
}

// Split text into visual lines while leaving the reading order intact.
// The original string is cached so resizing can rebuild the same lines.
function buildRevealLines(el) {
  if (!el.dataset.revealText) {
    el.dataset.revealText = el.textContent.replace(/\s+/g, ' ').trim();
  }

  const words = el.dataset.revealText.split(' ').filter(Boolean);
  if (!words.length) return;

  el.textContent = '';
  const wordNodes = [];

  words.forEach((word, index) => {
    const span = document.createElement('span');
    span.textContent = word;
    el.appendChild(span);
    if (index < words.length - 1) el.appendChild(document.createTextNode(' '));
    wordNodes.push(span);
  });

  const lines = [];
  let currentLine = null;
  let lastTop = null;

  wordNodes.forEach((node) => {
    const top = node.getBoundingClientRect().top;
    if (lastTop === null || Math.abs(top - lastTop) > 1.5) {
      currentLine = [];
      lines.push(currentLine);
      lastTop = top;
    }
    currentLine.push(node);
  });

  el.textContent = '';

  lines.forEach((lineWords, lineIndex) => {
    const line = document.createElement('span');
    line.className = 'line';
    const inner = document.createElement('span');
    inner.className = 'line-inner';
    inner.style.transitionDelay = `${Math.min(lineIndex * 70, 280)}ms`;

    lineWords.forEach((node, wordIndex) => {
      inner.appendChild(node);
      if (wordIndex < lineWords.length - 1) {
        inner.appendChild(document.createTextNode(' '));
      }
    });

    line.appendChild(inner);
    el.appendChild(line);
    // Keep a real space between wrapped lines so assistive technology and
    // copy/paste do not join the last word of one line to the next.
    if (lineIndex < lines.length - 1) {
      el.appendChild(document.createTextNode(' '));
    }
  });

  el.classList.add('lines-ready');
}

function initLineReveal() {
  const items = Array.from(document.querySelectorAll('.reveal-lines'));
  if (!items.length) return;

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-revealed'));
    return;
  }

  items.forEach(buildRevealLines);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2, rootMargin: '0px 0px -8% 0px' }
  );

  items.forEach((el) => observer.observe(el));

  let resizeTimer = null;
  window.addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        items.forEach(buildRevealLines);
      }, 250);
    },
    { passive: true }
  );
}

function initParallax() {
  const items = Array.from(document.querySelectorAll('[data-parallax]'));
  if (!items.length || prefersReducedMotion()) return;

  let ticking = false;

  const update = () => {
    ticking = false;
    const viewport = window.innerHeight;

    items.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -120 || rect.top > viewport + 120) return;

      const strength = parseFloat(el.dataset.parallax) || 0.05;
      const progress = Math.max(
        -1,
        Math.min(1, (rect.top + rect.height / 2 - viewport / 2) / viewport)
      );
      const offset = progress * strength * 100;

      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    });
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  update();
}

// =========================================================================
// 6. PROJECT CARDS
// =========================================================================

// Equalize project card heights on desktop side-by-side layout; on mobile,
// keep natural heights so sticky cards never extend past the viewport.
function initProjectCardHeights() {
  const cards = Array.from(document.querySelectorAll('.project-stack .project-card'));
  if (!cards.length) return;

  const canEqualize = () => window.matchMedia('(min-width: 981px)').matches;
  let frame = null;

  const apply = () => {
    cards.forEach((card) => {
      card.style.height = '';
    });
    if (!canEqualize()) return;

    const tallest = cards.reduce((max, card) => {
      const height = card.getBoundingClientRect().height;
      return height > max ? height : max;
    }, 0);

    cards.forEach((card) => {
      card.style.height = `${Math.ceil(tallest)}px`;
    });
  };

  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };

  schedule();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
}

// Smooth stacked-card depth animation on both desktop and mobile.
function initStackCards() {
  const cards = Array.from(document.querySelectorAll('.project-stack .stack-card'));
  if (cards.length < 2 || prefersReducedMotion()) return;

  let ticking = false;

  const update = () => {
    ticking = false;
    const isMobile = window.matchMedia('(max-width: 980px)').matches;
    const maxShrink = isMobile ? 0.03 : 0.045;

    for (let i = 0; i < cards.length - 1; i++) {
      const card = cards[i];
      const next = cards[i + 1];
      const cardRect = card.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(1, (cardRect.bottom - nextRect.top) / Math.max(180, cardRect.height)));

      if (overlap > 0.01) {
        const scale = (1 - overlap * maxShrink).toFixed(4);
        const brightness = (1 - overlap * 0.14).toFixed(3);
        card.classList.add('is-stacked');
        card.style.setProperty('--stack-scale', scale);
        card.style.setProperty('--stack-brightness', brightness);
      } else {
        card.classList.remove('is-stacked');
        card.style.removeProperty('--stack-scale');
        card.style.removeProperty('--stack-brightness');
      }
    }
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  update();
}

// =========================================================================
// 7. ACHIEVEMENT CHAPTERS
// =========================================================================

// One chapter open at a time. Closed panels are inert so their links and the
// certificate viewer stay out of the tab order.
function initAchievements() {
  const toggles = Array.from(document.querySelectorAll('.chapter-toggle'));
  if (!toggles.length) return;

  const setOpen = (toggle, open) => {
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    toggle.setAttribute('aria-expanded', String(open));
    if (!panel) return;

    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    if (open) {
      panel.removeAttribute('inert');
    } else {
      panel.setAttribute('inert', '');
    }
  };

  toggles.forEach((toggle, index) => {
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    if (panel) setOpen(toggle, panel.classList.contains('is-open'));

    toggle.addEventListener('click', () => {
      const nextOpen = toggle.getAttribute('aria-expanded') !== 'true';
      toggles.forEach((other) => setOpen(other, false));
      setOpen(toggle, nextOpen);
    });

    toggle.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowDown') nextIndex = (index + 1) % toggles.length;
      if (event.key === 'ArrowUp') nextIndex = (index - 1 + toggles.length) % toggles.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = toggles.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      toggles[nextIndex].focus();
    });
  });
}

// =========================================================================
// 8. GAME CONTROLS POPOVER
// =========================================================================

// The info button is a separate, dismissible panel beside the persistent Game
// Mode button. It closes on outside click or Escape.
function initGameControlsPanel() {
  const btn = document.getElementById('game-info-toggle');
  const panel = document.getElementById('game-controls-panel');
  const gameToggle = document.getElementById('game-mode-toggle');
  if (!btn || !panel) return;

  const isOpen = () => !panel.hasAttribute('hidden');

  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  };

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!isOpen());
  });

  if (gameToggle) {
    gameToggle.addEventListener('click', () => setOpen(false));
  }

  document.addEventListener('game-mode-closed', () => setOpen(false));

  document.addEventListener('click', (event) => {
    if (!isOpen()) return;
    if (panel.contains(event.target) || btn.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return;
    // Keep Escape from also reaching the game while closing this panel.
    event.stopPropagation();
    setOpen(false);
    btn.focus({ preventScroll: true });
  });
}

// =========================================================================
// 9. ACTIVE NAV SCROLL SPY, TOASTS & HERO SCRAMBLE
// =========================================================================
function initActiveNav() {
  const links = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));
  if (!links.length) return;

  const sections = links
    .map((link) => {
      const id = link.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      return section ? { id, link, section } : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  const header = document.querySelector('.site-header');
  let activeId = null;
  let ticking = false;
  let clickLockId = null;
  let clickLockTimer = null;

  const setCurrent = (id) => {
    if (activeId === id) return;
    activeId = id;
    sections.forEach((item) => {
      if (item.id === id) {
        item.link.setAttribute('aria-current', 'page');
      } else {
        item.link.removeAttribute('aria-current');
      }
    });
  };

  const update = () => {
    ticking = false;
    const headerHeight = header ? header.getBoundingClientRect().height : 68;
    const triggerY = headerHeight + 56;
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

    let currentId = sections[0].id;
    if (atBottom) {
      currentId = sections[sections.length - 1].id;
    } else {
      for (const item of sections) {
        const rect = item.section.getBoundingClientRect();
        if (rect.top <= triggerY) {
          currentId = item.id;
        }
      }
    }

    if (clickLockId) {
      if (currentId === clickLockId) {
        clickLockId = null;
        clearTimeout(clickLockTimer);
      } else {
        return;
      }
    }
    setCurrent(currentId);
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  links.forEach((link) => {
    link.addEventListener('click', () => {
      const id = link.getAttribute('href').slice(1);
      if (id) {
        clickLockId = id;
        clearTimeout(clickLockTimer);
        clickLockTimer = setTimeout(() => {
          clickLockId = null;
          update();
        }, 850);
        setCurrent(id);
      }
    });
  });

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  update();
}

let statusToastTimer = null;
function showStatusToast(message, type = 'success') {
  const toast = document.getElementById('status-toast');
  if (!toast) return;
  clearTimeout(statusToastTimer);
  toast.textContent = message;
  toast.classList.remove('is-success', 'is-error', 'is-visible');
  toast.classList.add(type === 'error' ? 'is-error' : 'is-success');
  toast.removeAttribute('hidden');
  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });
  statusToastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => {
      toast.setAttribute('hidden', '');
    }, 220);
  }, 2800);
}

function initCopyEmail() {
  const btn = document.getElementById('copy-email-btn');
  if (!btn) return;
  const email = btn.getAttribute('data-copy-email') || 'ayush04.sharma.codes@gmail.com';
  let busy = false;

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(email);
        btn.textContent = 'Copied';
        showStatusToast(`Copied ${email}`, 'success');
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      showStatusToast(`Copy unavailable — ${email}`, 'error');
    } finally {
      setTimeout(() => {
        btn.textContent = 'Copy email';
        busy = false;
      }, 1600);
    }
  });
}

function initCopyrightYear() {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-copyright-year]').forEach((el) => {
    el.textContent = year;
  });
}

function initJourneyNumbers() {
  const cards = Array.from(document.querySelectorAll('.journey-card'));
  const steps = Array.from(document.querySelectorAll('.journey-step[data-count-target]'));
  const titles = Array.from(document.querySelectorAll('.journey-fill-title'));
  if (!cards.length && !steps.length && !titles.length) return;

  const parseTarget = (raw) => {
    const str = String(raw || '').trim();
    const match = str.match(/^([^0-9.-]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
    if (!match) return null;
    const [, prefix, numStr, suffix] = match;
    const value = parseFloat(numStr);
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
    const minDigits = numStr.split('.')[0].length;
    return { prefix, value, decimals, minDigits, suffix, raw: str };
  };

  const formatValue = (parsed, current) => {
    const fixed = current.toFixed(parsed.decimals);
    const [intPart, decPart] = fixed.split('.');
    const paddedInt = intPart.padStart(parsed.minDigits, '0');
    return `${parsed.prefix}${decPart !== undefined ? `${paddedInt}.${decPart}` : paddedInt}${parsed.suffix}`;
  };

  const animateStep = (step) => {
    if (step.dataset.counted === 'true') return;
    step.dataset.counted = 'true';

    const parsed = parseTarget(step.getAttribute('data-count-target'));
    if (!parsed) return;

    if (prefersReducedMotion()) {
      step.textContent = parsed.raw;
      return;
    }

    step.textContent = formatValue(parsed, 0);
    const duration = 2600;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = parsed.value * eased;
      step.textContent = t >= 1 ? parsed.raw : formatValue(parsed, current);
      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const fillTitle = (title) => {
    if (title.dataset.filled === 'true') return;
    title.dataset.filled = 'true';
    requestAnimationFrame(() => {
      title.classList.add('is-filled');
    });
  };

  const trackCard = (card) => {
    if (card.dataset.tracked === 'true') return;
    card.dataset.tracked = 'true';
    requestAnimationFrame(() => {
      card.classList.add('is-tracked');
    });
  };

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    steps.forEach(animateStep);
    titles.forEach((t) => {
      t.dataset.filled = 'true';
      t.classList.add('is-filled');
    });
    cards.forEach((c) => {
      c.dataset.tracked = 'true';
      c.classList.add('is-tracked');
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.classList.contains('journey-card')) {
          trackCard(el);
        } else if (el.classList.contains('journey-step')) {
          animateStep(el);
        } else if (el.classList.contains('journey-fill-title')) {
          fillTitle(el);
        }
        observer.unobserve(el);
      });
    },
    { threshold: 0.25 }
  );

  cards.forEach((card) => observer.observe(card));
  steps.forEach((step) => observer.observe(step));
  titles.forEach((title) => observer.observe(title));
}

function initHeroScramble() {
  const el = document.querySelector('[data-scramble-words]');
  if (!el) return;
  const target = (el.getAttribute('data-scramble-words') || el.textContent).trim();
  const words = target.split(/\s+/).filter(Boolean);
  const glyphs = 'abcdefghijklmnopqrstuvwxyz0123456789';

  if (!words.length || prefersReducedMotion()) {
    el.textContent = target;
    return;
  }

  let started = false;
  const runSequence = () => {
    if (started) return;
    started = true;

    const decoded = [];
    let wordIndex = 0;

    const scrambleWord = (word) =>
      new Promise((resolve) => {
        const duration = Math.max(150, Math.min(280, word.length * 42));
        const start = performance.now();
        let lastTick = 0;

        const step = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          if (now - lastTick >= 40 || progress >= 1) {
            lastTick = now;
            const resolvedChars = Math.floor(progress * word.length);
            let active = '';
            for (let i = 0; i < word.length; i++) {
              const ch = word[i];
              if (i < resolvedChars || progress >= 1 || /[^a-zA-Z0-9]/.test(ch)) {
                active += ch;
              } else {
                const glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
                active += ch === ch.toUpperCase() ? glyph.toUpperCase() : glyph;
              }
            }
            el.textContent = [...decoded, active].join(' ');
          }

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            decoded.push(word);
            el.textContent = decoded.join(' ');
            resolve();
          }
        };

        requestAnimationFrame(step);
      });

    const next = async () => {
      if (wordIndex >= words.length) {
        el.textContent = target;
        return;
      }
      await scrambleWord(words[wordIndex]);
      wordIndex += 1;
      if (wordIndex < words.length) {
        setTimeout(next, 55);
      } else {
        el.textContent = target;
      }
    };

    next();
  };

  if (window.__portfolioEntrancePending) {
    window.addEventListener('portfolio:entered', runSequence, { once: true });
  } else {
    runSequence();
  }
}

// =========================================================================
// 10. UNIFIED PAGE ENTRANCE (Stage 1: fade-in -> Stage 2: Spider-Man drop)
// =========================================================================
function initPageEntrance() {
  const root = document.documentElement;
  let entered = false;

  const completeEntrance = () => {
    if (entered) return;
    entered = true;
    window.__portfolioEntrancePending = false;
    window.dispatchEvent(new CustomEvent('portfolio:entered'));
  };

  if (prefersReducedMotion() || !root.classList.contains('page-loading')) {
    root.classList.remove('page-loading');
    completeEntrance();
    return;
  }

  let startedFade = false;
  const startFade = () => {
    if (startedFade) return;
    startedFade = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const onTransitionEnd = (event) => {
          if (event.target !== document.body || event.propertyName !== 'opacity') return;
          document.body.removeEventListener('transitionend', onTransitionEnd);
          completeEntrance();
        };
        document.body.addEventListener('transitionend', onTransitionEnd);
        setTimeout(completeEntrance, 650);
        root.classList.remove('page-loading');
      });
    });
  };

  if (document.readyState === 'complete') {
    startFade();
  } else {
    window.addEventListener('load', startFade, { once: true });
    setTimeout(startFade, 350);
  }
}

// =========================================================================
// 10. INITIALIZATION
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  window.portfolioArcade = new PortfolioGameWidget();
  initFadeIn();
  initLineReveal();
  initParallax();
  initProjectCardHeights();
  initStackCards();
  initJourneyNumbers();
  initAchievements();
  initGameControlsPanel();
  initActiveNav();
  initCopyEmail();
  initCopyrightYear();
  initHeroScramble();
  initPageEntrance();
});
