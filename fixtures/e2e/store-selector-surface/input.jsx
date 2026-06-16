import { useStoreSelector as useSel } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const title = useSel((state) => state.hero.title);
	const visible = useSel((state) => state.visible);
	const products = useSel((state) => state.catalog.products);
	const renderedProducts = products.map((product) => (
		<article data-name={ product.name }>
			<h2>{ product.name }</h2>
			{ product.available && <span>{ product.price }</span> }
		</article>
	));

	return (
		<main>
			<h1>{ title }</h1>
			{ visible && <section>{ renderedProducts }</section> }
		</main>
	);
};

module.exports = { App };
