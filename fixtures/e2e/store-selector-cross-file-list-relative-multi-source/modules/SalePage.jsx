import { ProductCard } from './ProductCard.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const SalePage = () => {
	const saleProducts = useStoreSelector((state) => state.saleProducts);
	return (
		<main>
			{ saleProducts.map((product) => (
				<ProductCard product={ product } badges={ product.badges } />
			)) }
		</main>
	);
};

module.exports = { SalePage };
