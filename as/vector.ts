// A point or a direction in the game world: an origin, a velocity, angles.
//
// It is an array of three numbers underneath, so `origin[0]`, a native that
// takes a vector (get_distance_f, message_begin) and a literal written as
// `[0.0, 0.0, 100.0]` all keep working next to `origin.x` and `origin.add(...)`.
// Being an array is also why its size is `magnitude()`: `length` is already
// the array's 3.

/** Three numbers, x y z, with the math a plugin needs on them. */
export class Vector extends Array<number> {
	constructor(x: number = 0.0, y: number = 0.0, z: number = 0.0) {
		super(3);
		this[0] = x;
		this[1] = y;
		this[2] = z;
	}

	/** The x coordinate, `vector[0]`. */
	get x() { return this[0]; }
	set x(value: number) { this[0] = value; }

	/** The y coordinate, `vector[1]`. */
	get y() { return this[1]; }
	set y(value: number) { this[1] = value; }

	/** The z coordinate, `vector[2]`. */
	get z() { return this[2]; }
	set z(value: number) { this[2] = value; }

	/** A new vector: this one plus `other`, number by number. */
	add(other: number[]) {
		return new Vector(this[0] + other[0], this[1] + other[1], this[2] + other[2]);
	}

	/** A new vector: this one minus `other`, the way from `other` to this point. */
	subtract(other: number[]) {
		return new Vector(this[0] - other[0], this[1] - other[1], this[2] - other[2]);
	}

	/** A new vector with every number multiplied by `factor`. */
	scale(factor: number) {
		return new Vector(this[0] * factor, this[1] * factor, this[2] * factor);
	}

	/** The dot product with `other`; zero when the two are at right angles. */
	dot(other: number[]) {
		return this[0] * other[0] + this[1] * other[1] + this[2] * other[2];
	}

	/** The vector's length: the distance from the map's origin to this point. */
	magnitude() {
		return Math.sqrt(this.dot(this));
	}

	/** The distance from this point to `other`, in game units. */
	distanceTo(other: number[]) {
		return this.subtract(other).magnitude();
	}

	/** A new vector in the same direction, one unit long; a zero vector stays zero. */
	normalize() {
		const size = this.magnitude();
		return size > 0 ? this.scale(1 / size) : new Vector();
	}
}
