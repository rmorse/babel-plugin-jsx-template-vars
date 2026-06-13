const ProductLink = ({ label, url, available }) => {
	return (
		<a href={ url } data-available={ available }>
			{ available ? <strong>{ label }</strong> : <span>Hidden</span> }
		</a>
	);
};

ProductLink.templateVars = [
	'label',
	'url',
	'available',
];

const App = ({ title, hero, products, status, visible }) => {
	const renderedProducts = products.map((product) => (
		<ProductLink
			label={ product.label }
			url={ product.url }
			available={ product.available }
		/>
	));

	return (
		<main data-status={ status }>
			<h1>{ title }</h1>
			<p>{ hero.summary }</p>
			{ status === 'published' && <aside>{ status }</aside> }
			{ visible && <footer>Visible</footer> }
			{ products && <section>{ renderedProducts }</section> }
		</main>
	);
};

App.templateVars = [
	'title',
	'hero.summary',
	'status',
	'visible',
	'products[].label',
	'products[].url',
	'products[].available',
];

module.exports = { App };
