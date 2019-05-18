class ECS {
    constructor() {
        this.entities = [];
        this.usedIDsList = [];
        this.systems = [];
    }

    addEntity(entity) {
        entity.id = randomUint32ID(this.entities, this.usedIDsList);
        this.entities.push(entity);
    }

    removeEntity(entity) {
        this.entities.splice(this.entities.indexOf(entity), 1);
    }

    getEntitiesFor(mustHaveComponents, atLeastOneOfComponents = [], excludedComponents = []) {
        atLeastOneOfComponents = atLeastOneOfComponents ? atLeastOneOfComponents : mustHaveComponents;
        return this.entities.filter(entity => {
            excludedComponents.forEach(exclusion => {
                if (entity.getComponent(exclusion)) {
                    return false;
                }
            });
        })
            .filter(entity => {
                return atLeastOneOfComponents.some(atLeast => {
                    if (entity.getComponent(atLeast)) {
                        return true;
                    }
                });
            })
            .filter(entity => {
                mustHaveComponents.forEach(mustHave => {
                    if (entity.getComponent(mustHave)) {
                        return true;
                    }
                });
            });
    }

    addSystem(system) {
        this.systems.push(system);
    }

    getSystem(systemNumber) {
        return this.systems.find(system => system.systemNumber === systemNumber);
    }

    removeSystem() {
        const system = this.systems.find(system => system.systemNumber === systemNumber);
        if (system)
            this.systems.splice(this.systems.indexOf(system), 1);
    }

    update() {
        this.systems.forEach(system => {
            system.update(this.getEntitiesFor(system.mustHaveComponents, system.atLeastOneOfComponents, system.excludedComponents));
        });
    }
}

class Entity {
    constructor() {
        this.components = [];
        this.id;
    }

    addComponent(component) {
        this.components.push(component);
    }

    removeComponent(componentNumber) {
        const component = this.components.find(component => component.componentNumber === componentNumber);
        if (component)
            this.components.splice(this.components.indexOf(component), 1);
    }

    getComponent(componentNumber) {
        return this.components.find(component => component.componentNumber === componentNumber);
    }
}

class Family {
    constructor(mustHaveComponents, atLeastOneOfComponents = [], excludedComponents = []) {
        this.mustHaveComponents = mustHaveComponents;
        this.atLeastOneOfComponents = atLeastOneOfComponents;
        this.excludedComponents = excludedComponents;
    }
}

class Component {
    constuctor(number) {
        this.componentNumber = number;
    }
}

class System {
    constructor(systemNumber, mustHaveComponents, atLeastOneOfComponents = [], excludedComponents = []) {
        this.systemNumber = systemNumber;

        this.mustHaveComponents = mustHaveComponents;
        this.atLeastOneOfComponents = atLeastOneOfComponents;
        this.excludedComponents = excludedComponents;
    }

    update(entities) {
        entities.forEach(entity => {
            this.operate(entity);
        });
    }

    operate(entity) {

    }
}

function randomUint32ID(listOfObjects, usedIDsList) {
    // the items in the first array must have an .id property for this to work
    let newID = crypto.randomBytes(4).readUInt32BE(0, true);
    while (listOfObjects.find(object => object.id === newID) && usedIDsList.find(id => id === newID)) {
        newID = crypto.randomBytes(4).readUInt32BE(0, true);
    }

    usedIDsList.push(newID);
    return newID;
}