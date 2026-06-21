import { useMemo } from 'react';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';
import { Header } from './Header.jsx';
import { ProductCard } from './ProductCard.jsx';
import { useCurrentHero, useHeroView } from './hooks.jsx';

const App = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	const products = useStoreSelector((state) => state.products);
	const currentHero = useMemo(() => useCurrentHero(hero), [ hero ]);
	const heroView = useHeroView(currentHero);
	const visibleProducts = useMemo(() => products, [ products ]);
	const status = useMemo(() => currentHero.status, [ currentHero ]);

	return (
		<main>
			<Header {...heroView} hero={ currentHero } />
			{ status && <em>Live</em> }
			<section>
				{ visibleProducts.map((product) => (
					<ProductCard product={ product } />
				)) }
			</section>
		</main>
	);
};

module.exports = { App };
