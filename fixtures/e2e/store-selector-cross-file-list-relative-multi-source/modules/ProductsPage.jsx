import { ProductCard } from './ProductCard.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const ProductsPage = () => {
	const products = useStoreSelector((state) => state.products);
	return (
		<main>
			{ products.map((product) => (
				<ProductCard product={ product } badges={ product.badges } />
			)) }
		</main>
	);
};

module.exports = { ProductsPage };
