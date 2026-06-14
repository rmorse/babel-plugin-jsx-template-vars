const ProductCard = ({ title }) => {
	return <article>{ title }</article>;
};

ProductCard.templateVars = [ 'title' ];

const renderHelperProducts = (rows) => rows.map((row) => (
	<p>{ row.title }</p>
));

const App = ({ hero = {}, products = [] }) => {
	const heroAlias = $$hero;
	const { title: heading } = heroAlias;
	const filteredProducts = $$products.filter((product) => product.available);
	const renderedFeatured = filteredProducts.map(({ title, available, badges }) => (
		<div>
			{ available && <h2>{ title }</h2> }
			{ badges.filter((badge) => badge.visible).map(({ label }) => (
				<span>{ label }</span>
			)) }
		</div>
	));
	let reassignedProducts;
	reassignedProducts = $$products.map((product) => (
		<ProductCard {...product} />
	));

	return (
		<main>
			<h1>{ heading }</h1>
			<p>{ heroAlias?.summary }</p>
			<section className="featured">{ renderedFeatured }</section>
			<section className="reassigned">{ reassignedProducts }</section>
			<section className="helper">{ renderHelperProducts($$products) }</section>
		</main>
	);
};

module.exports = { App };
