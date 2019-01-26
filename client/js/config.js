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

        // meta
        movementSpeed: 0.5,
        threshold: 10 // distance to target before self destruction threshold
    }
};