import { Header, Panel } from './index.jsx';
import * as Cards from './Cards.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	const products = useStoreSelector((state) => state.products);
	const panelProps = { title: hero.kicker };

	return (
		<main>
			<Header hero={ hero } />
			<Panel {...panelProps}>
				{ products.map((product) => <Cards.ProductCard product={ product } />) }
			</Panel>
		</main>
	);
};

module.exports = { App };
