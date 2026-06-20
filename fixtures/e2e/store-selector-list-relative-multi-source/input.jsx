import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const ProductCard = ({ product, badges }) => (
	<article>
		<h2>{ product.name }</h2>
		<ul>
			{ badges.map((badge) => (
				<li>{ badge.label }</li>
			)) }
		</ul>
	</article>
);

const App = () => {
	const products = useStoreSelector((state) => state.products);
	const saleProducts = useStoreSelector((state) => state.saleProducts);
	return (
		<main>
			{ products.map((product) => (
				<ProductCard product={ product } badges={ product.badges } />
			)) }
			{ saleProducts.map((product) => (
				<ProductCard product={ product } badges={ product.badges } />
			)) }
		</main>
	);
};

module.exports = { App };
