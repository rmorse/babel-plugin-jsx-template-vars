# Babel JSX Template Props
A Babel transform for rendering a template friendly version of your JSX app.  Useful for generating a (currently mustache based) pre-render for achieving SSR in environments which don't support JavaScript rendering (e.g. PHP).

## What are template props
A template props are props which need to be connected to your data - when using this plugin, props your components props will be replaced with template strings such as `{{name}}`.

This rendered version of your app should be saved to static template files for processing via the server on page load / pre-render.

Currently supports [Mustache](https://mustache.github.io/) templates as they can be processed and rendered in almost any server environment.

Allowing us to achieve a level of (pseudo) SSR in environments such as PHP * **with a fair few limitations**.

## How it works

Add this transform to your pre-render build to replace your component props to with template strings (tags) such as `{{name}}`- allowing your markup to be processed as a Mustache compatible template.

### Workflow
1. Assumes you already have a React / Preact app with your development / production builds setup already.
2. Then you need to create an additional build, called a **pre-render** - which renders your app, and extracts the rendered html (markup after running your app) into a file.
3. **Add this plugin to the pre-render build**
4. Add `.templateProps` to components that have dynamic data.
5. Via your server side language (eg PHP), process the template file and pass in your data.

Note: You will still need to add this transform to your other builds (with the option `disabled: true`) so that it cleans up `templateProps` from your production/development code.

## How to use

`npm install babel-plugin-jsx-template-props`

Then add it as a plugin to build - if using webpack it would look like this:

```js
plugins: ['jsx-template-props'],
...
```

### Define which props will be template props

Add a `templateProps` property to your components so we know which props need to be replaced with template strings.

```jsx
const Person = ( { name } ) => {
    return (
        <div>{ name }</div>
    );
};
Person.templateProps = [ 'name' ];
```

Check out a full example... [ ] _working on it_...

## Caveats

### This is an experiment
As it says, this is an exploration on a concept of semi automating the generation of handlebars templates from JSX apps - its a first pass with a lot of holes and things to do as such its still in alpha - 0.0.1-alpha - _feel free to help with the project / offer alternative ideas for exploration / report bugs_.

### Data fetching & loading
One thing to watch out for is data fetching and loading.

In complex applications, props will often get passed down into various data fetching routines, and if they are replaced with template strings such as `{{name}}` it might cause them to fail.  They need to succeed and continue as usual to get a true render.

To work around this you can try to set your template props only on components that live underneath the data requests (futher down the tree) that use those props for data fetching.

### Nested props
This transform supports nested props (arrays and objects), but only supports 1 level of depth.

It is recommended to set template props on components that reside further down the tree and deal with those nested props directly.
