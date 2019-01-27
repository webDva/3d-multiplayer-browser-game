const ParticlesConfiguration = {
    Attack1Particles: {
        number: 17000, // max number of particles
        particleTexture: '/assets/particle_texture2.png',
        color1: new BABYLON.Color4(0.5, 0.2, 0.9, 1.0),
        color2: new BABYLON.Color4(0.3, 0.4, 0.4, 1.0),
        colorDead: new BABYLON.Color4(0, 0, 0, 0),
        minSize: 0.1,
        maxSize: 0.5,
        minLifeTime: 1,
        maxLifeTime: 5,
        emitRate: 3000,
        blendMode: BABYLON.ParticleSystem.BLENDMODE_STANDARD,
        gravity: new BABYLON.Vector3(0, -9.81, 0),
        minEmitPower: 1,
        maxEmitPower: 5,
        updateSpeed: 0.005,
        sphereEmitterRadius: 1,

        // meta
        type: 'Attack1',
        height: 5, // y-coordinate value
        movementSpeed: 0.5,
        threshold: 10 // distance to target before self destruction threshold
    },
    Attack2Particles: {
        number: 20000, // max number of particles
        particleTexture: '/assets/particle_texture2.png',
        color1: new BABYLON.Color4(0.5, 0.2, 0.9, 0.5),
        color2: new BABYLON.Color4(0.3, 0.4, 0.4, 1.0),
        colorDead: new BABYLON.Color4(1, 1, 1, 0),
        minSize: 0.1,
        maxSize: 0.5,
        minLifeTime: 1,
        maxLifeTime: 10,
        emitRate: 9000,
        blendMode: BABYLON.ParticleSystem.BLENDMODE_STANDARD,
        gravity: new BABYLON.Vector3(0, -9.81 * 10, 0),
        minEmitPower: 0,
        maxEmitPower: 1,
        updateSpeed: 0.005,

        // meta
        type: 'Attack2',
        height: 30, // how high above the target mesh
        ttl: 2300, // time to live for the entire particle effect in milliseconds
        circleRadius: 25 // for the 2D circle above the target's head
    }
};