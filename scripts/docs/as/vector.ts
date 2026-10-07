// The tooltips of as/vector.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Vector': {
		en: `Three numbers, x y z, with the math a plugin needs on them.`,
		ru: `Три числа, x y z, и вся математика над ними, которая нужна плагину.`,
	},
	'Vector.x': {
		en: `The x coordinate, \`vector[0]\`.`,
		ru: `Координата x, \`vector[0]\`.`,
	},
	'Vector.y': {
		en: `The y coordinate, \`vector[1]\`.`,
		ru: `Координата y, \`vector[1]\`.`,
	},
	'Vector.z': {
		en: `The z coordinate, \`vector[2]\`.`,
		ru: `Координата z, \`vector[2]\`.`,
	},
	'Vector.add': {
		en: `A new vector: this one plus \`other\`, number by number.`,
		ru: `Новый вектор: этот плюс \`other\`, число к числу.`,
	},
	'Vector.subtract': {
		en: `A new vector: this one minus \`other\`, the way from \`other\` to this point.`,
		ru: `Новый вектор: этот минус \`other\` — путь от \`other\` до этой точки.`,
	},
	'Vector.scale': {
		en: `A new vector with every number multiplied by \`factor\`.`,
		ru: `Новый вектор, где каждое число умножено на \`factor\`.`,
	},
	'Vector.dot': {
		en: `The dot product with \`other\`; zero when the two are at right angles.`,
		ru: `Скалярное произведение с \`other\`; ноль, если векторы перпендикулярны.`,
	},
	'Vector.magnitude': {
		en: `The vector's length: the distance from the map's origin to this point.`,
		ru: `Длина вектора: расстояние от начала координат карты до этой точки.`,
	},
	'Vector.distanceTo': {
		en: `The distance from this point to \`other\`, in game units.`,
		ru: `Расстояние от этой точки до \`other\`, в игровых единицах.`,
	},
	'Vector.normalize': {
		en: `A new vector in the same direction, one unit long; a zero vector stays zero.`,
		ru: `Новый вектор того же направления, длиной в единицу; нулевой вектор так и остаётся нулевым.`,
	},
	'Vector.fromAngles': {
		en: `
			The direction angles look in, one unit long:
			\`Vector.fromAngles(player.viewAngle).scale(500)\` is a push the way the
			player looks.

			Pawn: \`angle_vector(..., ANGLEVECTOR_FORWARD, ...)\`, \`velocity_by_aim\`
		`,
		ru: `
			Направление, куда смотрят углы, длиной в единицу:
			\`Vector.fromAngles(player.viewAngle).scale(500)\` — толчок туда, куда смотрит
			игрок.

			Pawn: \`angle_vector(..., ANGLEVECTOR_FORWARD, ...)\`, \`velocity_by_aim\`
		`,
	},
	'Vector.directions': {
		en: `
			The three directions of angles, one unit long each: where they look,
			to their right and above them - \`const { forward, right } =
			Vector.directions(player.viewAngle)\`.

			Pawn: \`angle_vector\`, \`engfunc(EngFunc_MakeVectors, ...)\`
		`,
		ru: `
			Три направления углов, каждое длиной в единицу: куда они смотрят, вправо от
			них и вверх — \`const { forward, right } = Vector.directions(player.viewAngle)\`.

			Pawn: \`angle_vector\`, \`engfunc(EngFunc_MakeVectors, ...)\`
		`,
	},
	'Vector.toAngles': {
		en: `
			The angles that look along this vector, as a player's view holds them -
			a pitch below the horizon positive: \`player.viewAngle =
			target.subtract(player.eyes).toAngles()\`. \`Vector.fromAngles\` turns
			them back.

			Pawn: \`vector_to_angle\`, \`engfunc(EngFunc_VecToAngles, ...)\`
		`,
		ru: `
			Углы, которые смотрят вдоль этого вектора, как их держит взгляд игрока, —
			наклон ниже горизонта положительный: \`player.viewAngle =
			target.subtract(player.eyes).toAngles()\`. \`Vector.fromAngles\` превращает их
			обратно.

			Pawn: \`vector_to_angle\`, \`engfunc(EngFunc_VecToAngles, ...)\`
		`,
	},
	'Directions': {
		en: `
			The three directions of angles: ahead, to the right and up - \`Vector.directions\`.
		`,
		ru: `
			Три направления углов: вперёд, вправо и вверх — \`Vector.directions\`.
		`,
	},
	'Directions.forward': {
		en: `
			The direction they look in.
		`,
		ru: `
			Направление, куда они смотрят.
		`,
	},
	'Directions.right': {
		en: `
			To their right.
		`,
		ru: `
			Вправо от них.
		`,
	},
	'Directions.up': {
		en: `
			Above them.
		`,
		ru: `
			Вверх от них.
		`,
	},
};
