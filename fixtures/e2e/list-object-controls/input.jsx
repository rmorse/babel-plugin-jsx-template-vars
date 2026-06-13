const Item = ({ label, active }) => {
	return (
		<li>
			{ active && <span>{ label }</span> }
		</li>
	);
};

Item.templateVars = [
	'label',
	[ 'active', { type: 'control' } ],
];

const App = ({ title, items, status }) => {
	return (
		<section>
			<h1>{ title }</h1>
			<ul>
				{ items.map((item) => (
					<Item label={ item.label } active={ item.active } />
				)) }
			</ul>
			{ status !== 'archived' && <footer>Visible</footer> }
		</section>
	);
};

App.templateVars = [
	'title',
	[ 'status', { type: 'control' } ],
	[
		'items',
		{
			type: 'list',
			child: {
				type: 'object',
				props: [ 'label', 'active' ],
			},
		},
	],
];

module.exports = { App };
