(function () {
  'use strict';

  const previewSeconds = 96;
  const night = {
    room: 0.11, roomColor: '#a9bce9', sky: 0.09, skyColor: '#7996dd',
    sun: 0, sunColor: '#ffd2a8', slope: 0.08, alongWindow: 0.40, lamp: 1,
  };
  const phases = [
    { hour: 0, ...night },
    { hour: 4.9, ...night },
    { hour: 5.55, room: 0.21, roomColor: '#b2c4f0', sky: 0.27, skyColor: '#b4c5fa',
      sun: 0.035, sunColor: '#ffd0ae', slope: 0.08, alongWindow: 0.53, lamp: 0.88 },
    { hour: 6.4, room: 0.63, roomColor: '#fff1ec', sky: 0.76, skyColor: '#ffd1c3',
      sun: 0.77, sunColor: '#ffccb9', slope: 0.155, alongWindow: 0.34, lamp: 0.19 },
    { hour: 8.6, room: 0.91, roomColor: '#fffaf3', sky: 0.97, skyColor: '#fff7eb',
      sun: 0.93, sunColor: '#fff1d9', slope: 0.245, alongWindow: 0.34, lamp: 0 },
    { hour: 12, room: 1, roomColor: '#ffffff', sky: 1, skyColor: '#ffffff',
      sun: 0.97, sunColor: '#fff4df', slope: 0.285, alongWindow: 0.25, lamp: 0 },
    { hour: 15.4, room: 0.94, roomColor: '#fffaf4', sky: 0.96, skyColor: '#fff5e5',
      sun: 0.92, sunColor: '#ffe8c7', slope: 0.255, alongWindow: 0.10, lamp: 0 },
    { hour: 17.9, room: 0.66, roomColor: '#ffe7d1', sky: 0.81, skyColor: '#ffc494',
      sun: 0.86, sunColor: '#ffb778', slope: 0.145, alongWindow: -0.05, lamp: 0.10 },
    { hour: 18.75, room: 0.37, roomColor: '#e7d2e9', sky: 0.49, skyColor: '#d6a8dd',
      sun: 0.29, sunColor: '#ff9d71', slope: 0.075, alongWindow: -0.10, lamp: 0.67 },
    { hour: 19.65, room: 0.17, roomColor: '#a9b9e7', sky: 0.18, skyColor: '#8ba0e4',
      sun: 0, sunColor: '#ffd2a8', slope: 0.08, alongWindow: 0.40, lamp: 1 },
    { hour: 21, ...night },
    { hour: 24, ...night },
  ];

  function localHour() {
    const time = new Date();
    return time.getHours() + (time.getMinutes() * 60 + time.getSeconds() + time.getMilliseconds() / 1000) / 3600;
  }

  function wrapHour(hour) {
    return ((hour % 24) + 24) % 24;
  }

  window.createAquariumDaylight = function () {
    const keys = phases.map((phase) => ({
      ...phase,
      roomColor: new THREE.Color(phase.roomColor),
      skyColor: new THREE.Color(phase.skyColor),
      sunColor: new THREE.Color(phase.sunColor),
    }));
    const uniforms = {
      uDaySunDirection: { value: new THREE.Vector3() },
      uDaySunColor: { value: new THREE.Color() },
      uDaySun: { value: 0 },
      uDayRoomTint: { value: new THREE.Color() },
      uDaySkyTint: { value: new THREE.Color() },
      uDaySky: { value: 0 },
      uDayLamp: { value: 0 },
      uDayLampColor: { value: new THREE.Color('#f7fbff') },
    };
    const { uDaySunDirection, uDaySunColor, uDaySun, uDayRoomTint, uDaySkyTint, uDaySky, uDayLamp } = uniforms;
    const background = new THREE.Color();
    const nightBackground = new THREE.Color('#080d16');
    const dayBackground = new THREE.Color('#434a54');
    let mode = 'local';
    let hour = localHour();
    let previewStart = null;
    let previewHour = hour;

    function update(seconds) {
      if (mode === 'local') hour = localHour();
      if (mode === 'preview') {
        if (previewStart === null) previewStart = seconds;
        hour = wrapHour(previewHour + Math.max(0, seconds - previewStart) * 24 / previewSeconds);
      }

      const next = keys.findIndex((key) => key.hour > hour);
      const before = keys[next - 1];
      const after = keys[next];
      const amount = THREE.MathUtils.smoothstep(hour, before.hour, after.hour);
      const lerp = THREE.MathUtils.lerp;
      uDayRoomTint.value.copy(before.roomColor).lerp(after.roomColor, amount)
        .multiplyScalar(lerp(before.room, after.room, amount));
      uDaySky.value = lerp(before.sky, after.sky, amount);
      uDaySkyTint.value.copy(before.skyColor).lerp(after.skyColor, amount);
      uDaySun.value = lerp(before.sun, after.sun, amount);
      uDaySunColor.value.copy(before.sunColor).lerp(after.sunColor, amount);
      uDaySunDirection.value.set(-1, -lerp(before.slope, after.slope, amount),
        lerp(before.alongWindow, after.alongWindow, amount)).normalize();
      uDayLamp.value = lerp(before.lamp, after.lamp, amount);
      background.copy(nightBackground).lerp(dayBackground, uDaySky.value ** 2);
      return hour;
    }

    function setHour(value) {
      if (!Number.isFinite(value)) return;
      hour = wrapHour(value);
      mode = 'manual';
    }

    function setMode(value) {
      if (value === 'preview') {
        previewHour = hour;
        previewStart = null;
        mode = value;
      } else if (value === 'local') {
        hour = localHour();
        mode = value;
      }
    }

    update(0);
    return { uniforms, background, update, setHour, setMode, getState: () => ({ hour, mode }) };
  };
})();
