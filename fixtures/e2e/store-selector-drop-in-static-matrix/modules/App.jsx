import { Header, Panel } from './index.jsx';
import * as Cards from './Cards.jsx';
import { useCurrentHero, useHeroView } from './hooks.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	const articleHero = useStoreSelector((state) => state.article.hero);
	const products = useStoreSelector((state) => state.products);
	const currentHero = useCurrentHero(hero);
	const articleView = useHeroView(articleHero);
	const panelProps = { title: currentHero.kicker };

	return (
		<main>
			<Header hero={ currentHero } />
			<Panel {...panelProps}>
				{ products.map((product) => <Cards.ProductCard product={ product } />) }
			</Panel>
			<aside>{ articleView.title }</aside>
		</main>
	);
};

module.exports = { App };
