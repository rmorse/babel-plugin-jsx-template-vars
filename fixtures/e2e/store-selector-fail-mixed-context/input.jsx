import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const Card = ({ name }) => (
	<article>{ name }</article>
);

const App = () => {
	const featured = useStoreSelector((state) => state.featured);
	const products = useStoreSelector((state) => state.products);
	return (
		<main>
			<Card name={ featured.name } />
			{ products.map((product) => (
				<Card name={ product.name } />
			)) }
		</main>
	);
};

module.exports = { App };
