import { ProductCard } from './index.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const products = useStoreSelector((state) => state.products);
	const tags = useStoreSelector((state) => state.tags);

	return (
		<main>
			{ products.map((product) => <ProductCard item={ product } />) }
			{ tags.map((tag) => <ProductCard item={ tag.meta } />) }
		</main>
	);
};

module.exports = { App };
