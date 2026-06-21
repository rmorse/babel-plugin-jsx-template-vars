export function useCurrentHero(hero) {
	return hero;
}

export function useHeroView(hero) {
	return {
		title: hero.title,
		kicker: hero.kicker,
	};
}

export function useProductView(product) {
	return {
		name: product.name,
		badges: product.badges,
	};
}
