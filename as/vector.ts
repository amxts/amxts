// A point or a direction in the game world: an origin, a velocity, angles.
//
// It is an array of three numbers underneath, so `origin[0]`, a native that
// takes a vector (get_distance_f, message_begin) and a literal written as
// `[0.0, 0.0, 100.0]` all keep working next to `origin.x` and `origin.add(...)`.
// Being an array is also why its size is `magnitude()`: `length` is already
// the array's 3.

/** Three numbers, x y z, with the math a plugin needs on them. */
export class Vector extends Array<number> {
	// The three numbers live in the object itself, after the array's fields:
	// a new Vector is one allocation, not an array and its buffer. Grown past
	// three, they move out to a buffer of their own, as any array's do.
	private room0: f64 = 0;
	private room1: f64 = 0;
	private room2: f64 = 0;

	// x, y and z are loads and stores at the array's data: a Vector is made
	// with room for three, which a shorter length leaves in place. An index,
	// even unchecked, was a call - and a write a checked one, which may grow.
	// The getters are inlined; a setter is small enough for a full build to
	// inline it (an accessor pair takes one decorator in the editor). The
	// constructor is inlined too, so a Vector that never leaves the function
	// that makes it - `player.origin.x` - is made in that function's frame.
	// @ts-ignore: decorator
	@inline constructor(x: number = 0.0, y: number = 0.0, z: number = 0.0) {
		// @ts-ignore: the compiler's own form of Array's constructor, which the editor's typings leave out
		super(3, true);
		// The array's buffer is the object itself, its data the room.
		const self = changetype<usize>(this);
		store<usize>(self, self, offsetof<ArrayBufferView>("buffer"));
		store<usize>(self, self + offsetof<Vector>("room0"), offsetof<ArrayBufferView>("dataStart"));
		store<i32>(self, 3 << alignof<f64>(), offsetof<ArrayBufferView>("byteLength"));
		store<f64>(this.dataStart, x);
		store<f64>(this.dataStart, y, 8);
		store<f64>(this.dataStart, z, 16);
	}

	/** The x coordinate, `vector[0]`. */
	@inline get x(): number { return load<f64>(this.dataStart); }
	set x(value: number) { store<f64>(this.dataStart, value); }

	/** The y coordinate, `vector[1]`. */
	@inline get y(): number { return load<f64>(this.dataStart, 8); }
	set y(value: number) { store<f64>(this.dataStart, value, 8); }

	/** The z coordinate, `vector[2]`. */
	@inline get z(): number { return load<f64>(this.dataStart, 16); }
	set z(value: number) { store<f64>(this.dataStart, value, 16); }

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

	/**
	 * The direction angles look in, one unit long:
	 * `Vector.fromAngles(player.viewAngle).scale(500)` is a push the way the
	 * player looks.
	 *
	 * Pawn: `angle_vector(..., ANGLEVECTOR_FORWARD, ...)`, `velocity_by_aim`
	 */
	static fromAngles(angles: number[]): Vector {
		const pitch = angles[0] * DEGREES;
		const yaw = angles[1] * DEGREES;
		const across = Math.cos(pitch);
		return new Vector(across * Math.cos(yaw), across * Math.sin(yaw), -Math.sin(pitch));
	}

	/**
	 * The three directions of angles, one unit long each: where they look,
	 * to their right and above them - `const { forward, right } =
	 * Vector.directions(player.viewAngle)`.
	 *
	 * Pawn: `angle_vector`, `engfunc(EngFunc_MakeVectors, ...)`
	 */
	static directions(angles: number[]): Directions {
		const pitch = angles[0] * DEGREES;
		const yaw = angles[1] * DEGREES;
		const roll = angles[2] * DEGREES;
		const sp = Math.sin(pitch), cp = Math.cos(pitch);
		const sy = Math.sin(yaw), cy = Math.cos(yaw);
		const sr = Math.sin(roll), cr = Math.cos(roll);
		return {
			forward: new Vector(cp * cy, cp * sy, -sp),
			right: new Vector(-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp),
			up: new Vector(cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp),
		};
	}

	/**
	 * The angles that look along this vector, as a player's view holds them -
	 * a pitch below the horizon positive: `player.viewAngle =
	 * target.subtract(player.eyes).toAngles()`. `Vector.fromAngles` turns
	 * them back.
	 *
	 * Pawn: `vector_to_angle`, `engfunc(EngFunc_VecToAngles, ...)`
	 */
	toAngles(): Vector {
		const x = this[0], y = this[1], z = this[2];
		if (x == 0 && y == 0) return new Vector(z > 0 ? -90 : 90, 0, 0);
		const yaw = Math.atan2(y, x) / DEGREES;
		return new Vector(-Math.atan2(z, Math.sqrt(x * x + y * y)) / DEGREES, yaw < 0 ? yaw + 360 : yaw, 0);
	}
}

const DEGREES: f64 = Math.PI / 180;

/** The three directions of angles: ahead, to the right and up - `Vector.directions`. */
export interface Directions {
	/** The direction they look in. */
	forward: Vector;
	/** To their right. */
	right: Vector;
	/** Above them. */
	up: Vector;
}
