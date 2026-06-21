import { Header, ProductCard } from './components/index.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

function App() {
	const hero = useStoreSelector((state) => state.home.hero);
	const products = useStoreSelector((state) => state.products);

	return (
		<main>
			<Header hero={ hero } />
			{ products.map((product) => <ProductCard product={ product } />) }
		</main>
	);
}

module.exports = { App };
