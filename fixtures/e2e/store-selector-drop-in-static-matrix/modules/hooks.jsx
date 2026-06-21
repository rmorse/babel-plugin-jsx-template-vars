export function useCurrentHero(hero) {
	return hero;
}

export function useHeroView(hero) {
	return {
		title: hero.kicker,
	};
}
