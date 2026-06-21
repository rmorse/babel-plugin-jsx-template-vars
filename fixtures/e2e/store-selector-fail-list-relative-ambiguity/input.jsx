import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const ItemCard = ({ item }) => (
	<article>{ item.name }</article>
);

const App = () => {
	const products = useStoreSelector((state) => state.products);
	const tags = useStoreSelector((state) => state.tags);
	return (
		<main>
			{ products.map((product) => (
				<ItemCard item={ product } />
			)) }
			{ tags.map((tag) => (
				<ItemCard item={ tag.meta } />
			)) }
		</main>
	);
};

module.exports = { App };
