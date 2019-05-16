const util = {};

util.createBinaryFrame = function (id, segments, id_size = true) { // segments is a list of objects with type and value properties
    let segments_length = 0;
    segments.forEach(segment => {
        switch (segment.type) {
            case 'Int8':
            case 'Uint8':
                segments_length += 1;
                break;
            case 'Int16':
            case 'Uint16':
                segments_length += 2;
                break;
            case 'Int32':
            case 'Uint32':
            case 'Float32':
                segments_length += 4;
                break;
            case 'Float64':
                segments_length += 8;
                break;
        }
    });

    // if id_size is true, the id is one byte. else the id is two bytes
    const IDSize = id_size ? 1 : 2;
    const arraybuffer = new ArrayBuffer(IDSize + segments_length);
    const dataview = new DataView(arraybuffer);

    switch (IDSize) {
        case 1:
            dataview.setUint8(0, id);
            break;
        case 2:
            dataview.setUint16(0, id);
            break;
    }

    // offsets will be automatically calculated by this function, so the user needs to establish his segments' order
    let offset = IDSize;
    segments.forEach(segment => {
        switch (segment.type) {
            case 'Int8':
                dataview.setInt8(offset, segment.value);
                offset += 1;
                break;
            case 'Uint8':
                dataview.setUint8(offset, segment.value);
                offset += 1;
                break;
            case 'Int16':
                dataview.setInt16(offset, segment.value);
                offset += 2;
                break;
            case 'Uint16':
                dataview.setUint16(offset, segment.value);
                offset += 2;
                break;
            case 'Int32':
                dataview.setInt32(offset, segment.value);
                offset += 4;
                break;
            case 'Uint32':
                dataview.setUint32(offset, segment.value);
                offset += 4;
                break;
            case 'Float32':
                dataview.setFloat32(offset, segment.value);
                offset += 4;
                break;
            case 'Float64':
                dataview.setFloat64(offset, segment.value);
                offset += 8;
                break;
        }
    });

    return dataview;
};

/**
 * Axis-aligned bounding boxes collision detection between two objects with an optional extension prediction.
 * @param {*} a The first object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members. Can have an extension for collision prediction with the parameter `a_extension`.
 * @param {*} b The second object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members.
 * @param {*} a_extension Used for predictions. Must have `.x` and `.z` members. If the axis has no extension, then it should be `0`.
 * @return `true` if collison has been detected, `false` otherwise.
 */
util.AABBCollision = function (a, b, a_extension = { x: 0, z: 0 }) {
    return (a.x - (a.collisionBoxSize / 2) + a_extension.x <= b.x + (b.collisionBoxSize / 2) && a.x + (a.collisionBoxSize / 2) + a_extension.x >= b.x - (b.collisionBoxSize / 2)) &&
        (a.z - (a.collisionBoxSize / 2) + a_extension.z <= b.z + (b.collisionBoxSize / 2) && a.z + (a.collisionBoxSize / 2) + a_extension.z >= b.z - (b.collisionBoxSize / 2));
};

if (typeof module === 'object') {
    module.exports = util;
} else {
    window.util = util;
}